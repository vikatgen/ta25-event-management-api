---
title: 34. Pileti tühistamine ja Stripe'i tagasimakse
milestone: M8 – Tühistamine
labels: api, suurus: L
---

## Eesmärk

Ostja saab tühistada **ühe** oma pileti kuni ürituse alguseni ja saab raha Stripe'i kaudu tagasi. Kõik toimub ühe päringu ajal (järjekorra lisame #35-s).

| Meetod | Aadress | Vastus |
|---|---|---|
| `POST` | `/api/tickets/:id/cancel` | `200` tühistatud pilet, `404` pole sinu oma, `409` ei saa tühistada |

## Taust

- **Ühe pileti tühistamine**, mitte terve tellimuse. Tellimus jääb `paid`: tühistatud on üks pilet.
- **Tagasi kogu pileti hind** (`priceCents` piletilt, hetktõmmis #27). Stripe'is on see **osaline tagasimakse** tellimuse makse pealt. Selleks oligi vaja `stripePaymentIntentId`-d (#32).
- **Reeglid:** ainult `active` pilet ja ainult enne ürituse algust (`startsAt`), muidu `409`.
- **Võõras pilet annab `404`, mitte `403`:** nii ei saa teiste piletite olemasolu ära arvata (sama mõte mis mustandil, #19). Admin võib tühistada iga pileti.
- **Järjekord on oluline:**
  ```
  kontrollid → Stripe'i tagasimakse → TEHING (pilet cancelled + sold - 1)
  ```
  **Välist teenust ei kutsuta tehingu sees.** Kui Stripe kukub, pole meie baasis midagi muutunud ja kasutaja võib uuesti proovida.
- **Topeltklõps:** kaks päringut korraga.
  - Stripe: **idempotency key** = `refund-<pileti id>`. Sama võtmega teine päring ei tee uut tagasimakset, vaid tagastab esimese tulemuse.
  - Andmebaas: `UPDATE ... WHERE status = 'active'` laseb läbi ainult ühe (sama muster nagu `reserve`, #29). `sold - 1` tehakse ainult siis, kui pilet päriselt tühistati.
- **Uus moodul `ticket`:** üksiku pileti päringud. Pileti loomine jääb `OrderRepository`-sse (luuakse koos tellimusega).
- **Piletitüübi kustutamise reegel muutub:** tühistatud pilet jääb alles (ajalugu) ja viitab endiselt tüübile (`restrict`). Pärast tühistamist on `sold = 0`, aga pilet on olemas: #25 reegel `sold > 0` laseks kustutada ja andmebaas annaks `500`. Uus reegel: **kas tüübil on ükskõik mis olekus pilet**.

## Sammud

1. `payment.gateway.ts`:
   ```ts
   async refund(paymentIntentId: string, amountCents: number, idempotencyKey: string): Promise<void> {
       await this.stripe.refunds.create({payment_intent: paymentIntentId, amount: amountCents}, {idempotencyKey});
   }
   ```
2. `src/ticket/ticket.repository.ts`:
   ```ts
   import {and, eq, getTableColumns} from "drizzle-orm";
   import type {Database, Transaction} from "../db/index.js";
   import {eventSchema} from "../db/schema/event.schema.js";
   import {orderSchema, type Ticket, ticketSchema} from "../db/schema/order.schema.js";

   export type TicketDetails = Ticket & {
       userId: string;
       eventId: string;
       eventStartsAt: Date;
       stripePaymentIntentId: string | null;
   };

   export class TicketRepository {
       constructor(private readonly db: Database) {}

       async findById(id: string): Promise<TicketDetails | undefined> {
           const [ticket] = await this.selectDetails().where(eq(ticketSchema.id, id));
           return ticket;
       }

       async cancel(id: string, tx?: Transaction): Promise<Ticket | undefined> {
           const db = tx ?? this.db;
           const [ticket] = await db
               .update(ticketSchema)
               .set({status: "cancelled"})
               .where(and(eq(ticketSchema.id, id), eq(ticketSchema.status, "active")))
               .returning();
           return ticket;
       }

       private selectDetails() {
           return this.db
               .select({
                   ...getTableColumns(ticketSchema),
                   userId: orderSchema.userId,
                   eventId: orderSchema.eventId,
                   eventStartsAt: eventSchema.startsAt,
                   stripePaymentIntentId: orderSchema.stripePaymentIntentId,
               })
               .from(ticketSchema)
               .innerJoin(orderSchema, eq(ticketSchema.orderId, orderSchema.id))
               .innerJoin(eventSchema, eq(orderSchema.eventId, eventSchema.id));
       }
   }
   ```
   - **`JOIN`:** üks päring kolmest tabelist. Omanik ja makse id on tellimusel, algusaeg üritusel.
   - `getTableColumns(ticketSchema)`: kõik pileti veerud, millele lisame vajalikud väljad teistest tabelitest.
   - `selectDetails` on eraldi, sest hiljem (#40) tuleb teine otsing sama kujuga.
3. `src/ticket/ticket.service.ts`:
   ```ts
   import type {AuthUser} from "../auth/express.js";
   import type {Database} from "../db/index.js";
   import type {Ticket} from "../db/schema/order.schema.js";
   import type {PaymentGateway} from "../payment/payment.gateway.js";
   import {ConflictError, NotFoundError} from "../shared/errors/http.errors.js";
   import {UnexpectedError} from "../shared/errors/unexpected.error.js";
   import type {TicketTypeRepository} from "../ticket-type/ticket-type.repository.js";
   import type {TicketDetails, TicketRepository} from "./ticket.repository.js";

   export class TicketService {
       constructor(
           private readonly db: Database,
           private readonly ticketRepository: TicketRepository,
           private readonly ticketTypeRepository: TicketTypeRepository,
           private readonly paymentGateway: PaymentGateway,
       ) {}

       async cancel(id: string, user: AuthUser): Promise<Ticket> {
           const ticket = await this.findOwnedById(id, user);

           if (ticket.status !== "active") {
               throw new ConflictError("Tühistada saab ainult kehtivat piletit");
           }

           if (new Date() >= ticket.eventStartsAt) {
               throw new ConflictError("Üritus on juba alanud, piletit ei saa tühistada");
           }

           if (!ticket.stripePaymentIntentId) {
               throw new UnexpectedError("Makstud tellimusel puudub Stripe'i makse id");
           }

           await this.paymentGateway.refund(ticket.stripePaymentIntentId, ticket.priceCents, `refund-${ticket.id}`);

           const cancelled = await this.db.transaction(async (tx) => {
               const cancelled = await this.ticketRepository.cancel(ticket.id, tx);

               if (cancelled) {
                   await this.ticketTypeRepository.release(ticket.eventId, ticket.ticketTypeId, 1, tx);
               }

               return cancelled;
           });

           if (!cancelled) {
               throw new ConflictError("Pilet on juba tühistatud");
           }

           return cancelled;
       }

       private async findOwnedById(id: string, user: AuthUser): Promise<TicketDetails> {
           const ticket = await this.ticketRepository.findById(id);

           if (!ticket || (user.role !== "admin" && ticket.userId !== user.id)) {
               throw new NotFoundError("Piletit ei leitud");
           }

           return ticket;
       }
   }
   ```
   - `UnexpectedError`: `active` piletil on alati makstud tellimus ja seega makse id. Kui pole, on meie loogikas viga (`500`).
   - Kui teine päring jõudis vahepeal ette, tagastab `cancel` `undefined` ja `sold`-i ei vähendata.
4. `src/ticket/ticket.controller.ts`:
   ```ts
   export const ticketIdParams = z.object({id: z.uuid()});

   export class TicketController {
       constructor(private readonly service: TicketService) {}

       cancel: RequestHandler = async (req, res) => {
           const {id} = ticketIdParams.parse(req.params);
           const ticket = await this.service.cancel(id, req.user!);
           res.json(toTicketResponse(ticket));
       };
   }
   ```
   `toTicketResponse` on #28-st (`order-response.dto.ts`).
5. `src/ticket/ticket.routes.ts`:
   ```ts
   const ticketRepository = new TicketRepository(db);
   const ticketService = new TicketService(db, ticketRepository, ticketTypeRepository, new PaymentGateway(stripe));
   const ticketController = new TicketController(ticketService);

   export const ticketRouter = Router();

   ticketRouter.use(requireAuth);

   ticketRouter.post("/:id/cancel", ticketController.cancel);
   ```
   `src/app.ts`: `app.use("/api/tickets", ticketRouter);`
6. **Piletitüübi kustutamine.** `ticket-type.repository.ts`:
   ```ts
   async hasTickets(id: string): Promise<boolean> {
       const [ticket] = await this.db
           .select({id: ticketSchema.id})
           .from(ticketSchema)
           .where(eq(ticketSchema.ticketTypeId, id))
           .limit(1);
       return ticket !== undefined;
   }
   ```
   `ticket-type.service.ts` `delete`:
   ```ts
   if (await this.repository.hasTickets(id)) {
       throw new ConflictError("Piletitüüpi, millel on pileteid, ei saa kustutada");
   }
   ```
   (asendab `existing.sold > 0` kontrolli)
7. Testid. `tests/helpers/stripe.ts`:
   ```ts
   export function mockStripeRefund() {
       return vi.spyOn(stripe.refunds, "create").mockResolvedValue({id: "re_test"} as unknown as Stripe.Response<Stripe.Refund>);
   }
   ```
   `tests/ticket/ticket.routes.test.ts` (kasuta `buyPaidTickets` #32-st):
   - `401`, vigane uuid → `400`
   - omanik tühistab: `200`, `status: "cancelled"`, Stripe'ile läks `payment_intent: "pi_test"`, õige `amount` ja `idempotencyKey`, `sold` vähenes
   - teise kasutaja pilet → `404`, admin võib → `200`
   - juba tühistatud → `409`, üritus alanud → `409`
   - Stripe kukub (`mockRejectedValue`) → `500` ja pilet jääb `active`
   - **topeltklõps:** kaks samaaegset tühistamist (`Promise.all`) → üks `200`, teine `409`, `sold` vähenes **ühe** võrra
   - piletitüüpi, millel on tühistatud pilet, ei saa kustutada → `409`, mitte `500`
8. **Proovi päriselt:** osta testkaardiga pilet (#31, #32), tühista konsoolist (`fetch("/api/tickets/<id>/cancel", {method: "POST"})`). Stripe Dashboard → Payments → makse juures on "Partial refund". Seeditud piletitega see ei tööta, sest nende `pi_seed_...` id-d pole Stripe'is olemas (#32).

## Valmis, kui…

- [ ] Omanik saab kehtiva pileti enne algust tühistada ja raha läheb tagasi
- [ ] Stripe'i kukkumisel ei muutu andmebaasis midagi
- [ ] Topeltklõps vähendab `sold`-i ainult ühe korra
- [ ] Piletitüüpi, millel on ükskõik mis olekus pilet, ei saa kustutada
- [ ] Testid on rohelised

## Mida sa saavutasid

- **Nüüd töötab:** Ostja saab pileti tühistada ja saab raha tagasi.
- **Said selgeks:** Kui väline teenus kukub, ei tohi andmebaas jääda poolikusse olekusse. Topeltklõps ei tohi teha topelttagastust.
- **Edasi:** Praegu ootab kasutaja Stripe'i järel. Järgmine samm viib selle töö taustale.

## Kontrollküsimused

1. **Miks Stripe'i kutse on enne tehingut, mitte selle sees?** Väline teenus ei kuulu tehingusse: kui see kukub, ei tohi baas muutuda, ja tehing ei tohi ridu lukus hoida.
2. **Mida teeb idempotency key?** Sama võtmega korduv päring ei tee uut tagasimakset.
3. **Miks võõras pilet annab `404`?** `403` reedaks, et selline pilet on olemas.

## Materjalid

- 📖 [M6 › Taustatööd ja järjekorrad](https://vikatgen.github.io/oppematerjalid/veebirakendused/backend/13-taustatood-ja-jarjekorrad): järjekord, worker, uuesti proovimine, fan-out, töö tehingus, idempotency key
- [Stripe API: Create a refund](https://docs.stripe.com/api/refunds/create)
- [Stripe: Idempotent requests](https://docs.stripe.com/api/idempotent_requests)
- [Drizzle: Joins](https://orm.drizzle.team/docs/joins)

## Sõltub

- #33
