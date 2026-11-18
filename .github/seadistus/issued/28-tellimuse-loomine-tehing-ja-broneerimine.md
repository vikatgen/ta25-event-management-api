---
title: 28. Tellimuse loomine: tehing ja broneerimine
milestone: M6 – Tellimused
labels: api, suurus: L
---

## Eesmärk

`POST /api/orders` ostab pileteid: kas **kõik** korvi read õnnestuvad või ei muutu andmebaasis **midagi**. Selles issues on makse "kohe tehtud" (tellimus läheb otse `paid` olekusse). Päris makse tuleb Stripe'iga (#31).

```json
POST /api/orders
{ "eventId": "...", "items": [{"ticketTypeId": "...", "quantity": 2}, {"ticketTypeId": "...", "quantity": 1}] }
```

## Taust

**Üks ost muudab mitut tabelit:** piletitüübi `sold` suureneb, tekib tellimus, tekivad piletid. Mis juhtub, kui teine korvi rida ei mahu (VIP on otsas)?

**Tehing (transaction):** kõik päringud tehingu sees on üks tervik. Kui üks kukub (`throw`), teeb Postgres `ROLLBACK` ja ka eelmised muudatused kaovad. Muidu oleks tavapiletid broneeritud ilma tellimuseta.

```
db.transaction(async (tx) => {
    reserve(tavapilet, 2, tx)    ✅ sold 0 → 2
    reserve(VIP, 1, tx)          ❌ ei mahu → throw ConflictError
})                               → ROLLBACK: tavapileti sold on jälle 0 → 409
```

- **NB! Iga päring tehingu sees peab saama `tx`.** Unustatud `tx` jookseb tehingust **väljas** ja jääb ROLLBACK-i järel alles. TypeScript seda ei märka. Seepärast on repository meetoditel valikuline `tx?` parameeter: `const db = tx ?? this.db`.
- **`tx` lisame alles nüüd**, kui päris kasutus seda nõuab, mitte "igaks juhuks" varem.
- **Broneerimine on üks SQL-lause:**
  ```sql
  UPDATE ticket_types SET sold = sold + 2
  WHERE id = ? AND event_id = ? AND sold + 2 <= capacity
  RETURNING *
  ```
  Kui ei mahu, ei muutu ükski rida ja tuleb `undefined`. Miks just nii, vaatame #29-s.
- **Teise mooduli repository:** broneerimine peab jooksma **meie** tehingu sees, seega `OrderService` saab `TicketTypeRepository` (mitte service'i, sest service'i meetodid `tx`-i ei võta). Ürituse reeglid ("kas avaldatud") küsime endiselt `EventService`-ilt.
- **Ostukorv elab frontendis**, server saab ühe lõpliku päringu. Serveripoolne korv oleks lisatabel + aegumine + hüljatud korvid.
- 🟢 Frontendi "ostukorv ja suunamine Stripe'i" kasutab seda route'i.

## Sammud

1. `src/db/index.ts`:
   ```ts
   export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
   ```
   Loe seestpoolt väljapoole: `Database["transaction"]` → funktsioon `db.transaction`, esimene `Parameters<...>[0]` → tema callback `async (tx) => ...`, teine → callbacki argument `tx`. Tüüp tuleb otse Drizzle'ist.
2. `src/ticket-type/ticket-type.repository.ts`:
   ```ts
   async reserve(eventId: string, id: string, quantity: number, tx?: Transaction): Promise<TicketType | undefined> {
       const db = tx ?? this.db;
       const [ticketType] = await db
           .update(ticketTypeSchema)
           .set({sold: sql`${ticketTypeSchema.sold} + ${quantity}`})
           .where(
               and(
                   eq(ticketTypeSchema.id, id),
                   eq(ticketTypeSchema.eventId, eventId),
                   sql`${ticketTypeSchema.sold} + ${quantity} <= ${ticketTypeSchema.capacity}`,
               ),
           )
           .returning();
       return ticketType;
   }
   ```
   `ticket-type.routes.ts`: `export const ticketTypeRepository = ...` (lisa `export`).
3. `src/order/dto/create-order.dto.ts`:
   ```ts
   import z from "zod";

   export const createOrderDto = z.object({
       eventId: z.uuid(),
       items: z
           .array(
               z.object({
                   ticketTypeId: z.uuid(),
                   quantity: z.int().min(1).max(10),
               }),
           )
           .min(1)
           .refine((items) => new Set(items.map((item) => item.ticketTypeId)).size === items.length, {
               message: "Sama piletitüüp on korvis mitu korda",
           }),
   });

   export type CreateOrderDto = z.infer<typeof createOrderDto>;
   ```
4. `src/order/dto/order-response.dto.ts`: tüübid `TicketResponseDto` (`id`, `ticketTypeId`, `priceCents`, `code`, `status`) ja `OrderResponseDto` (`id`, `eventId`, `status`, `totalCents`, `createdAt`, `tickets`) ning funktsioonid `toTicketResponse(ticket)` ja `toOrderResponse(order)`. `toTicketResponse` on eraldi, sest pileti tühistamine (#34) tagastab ühe pileti.
5. `src/order/order.repository.ts`:
   ```ts
   import {and, eq} from "drizzle-orm";
   import type {Database, Transaction} from "../db/index.js";
   import {
       type CreateOrder,
       type CreateTicket,
       type OrderWithTickets,
       orderSchema,
       ticketSchema,
   } from "../db/schema/order.schema.js";
   import {UnexpectedError} from "../shared/errors/unexpected.error.js";

   export class OrderRepository {
       constructor(private readonly db: Database) {}

       async create(
           order: CreateOrder,
           tickets: Omit<CreateTicket, "orderId">[],
           tx?: Transaction,
       ): Promise<OrderWithTickets> {
           const db = tx ?? this.db;

           const [createdOrder] = await db.insert(orderSchema).values(order).returning();

           if (!createdOrder) {
               throw new UnexpectedError("INSERT ei tagastanud tellimust");
           }

           const createdTickets = await db
               .insert(ticketSchema)
               .values(tickets.map((ticket) => ({...ticket, orderId: createdOrder.id})))
               .returning();

           return {...createdOrder, tickets: createdTickets};
       }

       async markPaid(id: string, tx?: Transaction): Promise<OrderWithTickets | undefined> {
           const db = tx ?? this.db;

           const [order] = await db
               .update(orderSchema)
               .set({status: "paid"})
               .where(and(eq(orderSchema.id, id), eq(orderSchema.status, "pending")))
               .returning();

           if (!order) {
               return undefined;
           }

           const tickets = await db
               .update(ticketSchema)
               .set({status: "active"})
               .where(eq(ticketSchema.orderId, id))
               .returning();

           return {...order, tickets};
       }
   }
   ```
   - `Omit<CreateTicket, "orderId">`: piletitel pole veel tellimuse id-d, selle lisab repository pärast tellimuse loomist.
   - `WHERE status = 'pending'`: makstuks saab märkida ainult ootel tellimust ja ainult **üks kord**.
6. `src/order/order.service.ts`:
   ```ts
   import type {AuthUser} from "../auth/express.js";
   import type {Database} from "../db/index.js";
   import type {Event} from "../db/schema/event.schema.js";
   import type {CreateTicket, OrderWithTickets} from "../db/schema/order.schema.js";
   import type {TicketType} from "../db/schema/ticket-type.schema.js";
   import type {EventService} from "../event/event.service.js";
   import {ConflictError, NotFoundError} from "../shared/errors/http.errors.js";
   import type {TicketTypeRepository} from "../ticket-type/ticket-type.repository.js";
   import type {CreateOrderDto} from "./dto/create-order.dto.js";
   import type {OrderRepository} from "./order.repository.js";

   export class OrderService {
       constructor(
           private readonly db: Database,
           private readonly orderRepository: OrderRepository,
           private readonly ticketTypeRepository: TicketTypeRepository,
           private readonly eventService: EventService,
       ) {}

       async create(dto: CreateOrderDto, user: AuthUser): Promise<OrderWithTickets> {
           const event = await this.eventService.findPublishedById(dto.eventId);
           this.assertSalesOpen(event);
           const ticketTypes = await this.findTicketTypes(dto);

           const order = await this.reserve(dto, user, ticketTypes);

           return this.markPaid(order.id);
       }

       async markPaid(orderId: string): Promise<OrderWithTickets> {
           const order = await this.db.transaction((tx) => this.orderRepository.markPaid(orderId, tx));

           if (!order) {
               throw new ConflictError("Tellimus ei ole enam makse ootel");
           }

           return order;
       }

       private async reserve(
           dto: CreateOrderDto,
           user: AuthUser,
           ticketTypes: Map<string, TicketType>,
       ): Promise<OrderWithTickets> {
           return this.db.transaction(async (tx) => {
               const tickets: Omit<CreateTicket, "orderId">[] = [];

               for (const item of dto.items) {
                   const reserved = await this.ticketTypeRepository.reserve(
                       dto.eventId,
                       item.ticketTypeId,
                       item.quantity,
                       tx,
                   );

                   if (!reserved) {
                       const name = ticketTypes.get(item.ticketTypeId)?.name;
                       throw new ConflictError(`Piletitüüpi "${name}" ei ole piisavalt alles`);
                   }

                   for (let i = 0; i < item.quantity; i++) {
                       tickets.push({
                           ticketTypeId: reserved.id,
                           priceCents: reserved.priceCents,
                           code: crypto.randomUUID(),
                       });
                   }
               }

               const totalCents = tickets.reduce((sum, ticket) => sum + ticket.priceCents, 0);

               return this.orderRepository.create({userId: user.id, eventId: dto.eventId, totalCents}, tickets, tx);
           });
       }

       private assertSalesOpen(event: Event): void {
           const now = new Date();

           if (now < event.salesStartAt || now > event.salesEndAt) {
               throw new ConflictError("Piletimüük ei ole praegu avatud");
           }
       }

       private async findTicketTypes(dto: CreateOrderDto): Promise<Map<string, TicketType>> {
           const ticketTypes = new Map<string, TicketType>();

           for (const item of dto.items) {
               const ticketType = await this.ticketTypeRepository.findById(dto.eventId, item.ticketTypeId);

               if (!ticketType) {
                   throw new NotFoundError("Piletitüüpi ei leitud");
               }

               ticketTypes.set(ticketType.id, ticketType);
           }

           return ticketTypes;
       }
   }
   ```
   - Kontrollid (avaldatud, müük käib, tüübid kuuluvad sellele üritusele) on **enne** tehingut: tehing on lühike ja lukustab ridu võimalikult vähe aega.
   - `throw` tehingu sees → Drizzle teeb `ROLLBACK` ja viskab vea edasi (→ `409`).
   - `db` on service'is ainult `db.transaction(...)` jaoks: päringud on endiselt repository's.
   - `crypto.randomUUID()`: Node'i sisseehitatud, juhuslik ja ära arvamatu.
7. `src/order/order.controller.ts`: `create` (`createOrderDto.parse` → `service.create(dto, req.user!)` → `201` + `toOrderResponse`).
   `src/order/order.routes.ts`:
   ```ts
   const orderRepository = new OrderRepository(db);
   const orderService = new OrderService(db, orderRepository, ticketTypeRepository, eventService);
   const orderController = new OrderController(orderService);

   export const orderRouter = Router();

   orderRouter.use(requireAuth);

   orderRouter.post("/", orderController.create);
   ```
   Osta võib iga sisselogitud kasutaja: rolli ei kontrollita.
8. `src/app.ts`: `app.use("/api/orders", orderRouter);`
9. Testid:
   - `tests/helpers/factories.ts`: `orderBody(eventId, items)` → `{eventId, items}`
   - `tests/helpers/api.ts`: `createTicketType` (kui #25-s puudus) ja `createOnSaleEvent(ticketTypes)`: avaldatud üritus, mille müük käib **praegu** (müük eilsest homseni), koos piletitüüpidega. `eventBody()` kuupäevad on tulevikus, seal müük veel ei käi.
   - `tests/order/dto/create-order.dto.test.ts`: tühi korv, `quantity: 11`, sama tüüp kaks korda
   - `tests/order/order.routes.test.ts`:
     - `401` sisselogimata
     - 3 piletiga tellimus: `201`, õige `totalCents`, piletitel unikaalsed `code`-id, `status: "paid"`
     - `sold` suurenes
     - **ROLLBACK:** 2 tavapiletit + 2 VIP-i, VIP-e on 1 → `409` ja **tavapiletite `sold` jääb 0**
     - müük pole avatud → `409`, mustand → `404`, teise ürituse piletitüüp → `404`
   - Täida #25 `it.todo` testid: kogust ei saa vähendada alla müüdu (`409`), müükidega tüüpi ei saa kustutada (`409`)
10. **Proovi:** võta `reserve` kutsest `tx` ära. ROLLBACK test kukub: broneering jäi alles, kuigi tellimust ei tekkinud. Pane tagasi.

## Valmis, kui…

- [ ] Ost loob tellimuse ja piletid ning suurendab `sold`-i
- [ ] Kui üks rida ei mahu, ei muutu andmebaasis midagi (ROLLBACK test)
- [ ] `tx`-i eemaldamine teeb ROLLBACK testi punaseks
- [ ] #25 ootel testid on täidetud ja rohelised

## Mida sa saavutasid

- **Nüüd töötab:** Piletite ostmine töötab ja kui üks korvi rida ei mahu, ei muutu andmebaasis midagi.
- **Said selgeks:** **Tehing**: kõik või mitte midagi. ROLLBACK test tõestab seda.
- **Edasi:** Järgmises sammus selgub, mis juhtub, kui kaks inimest ostavad viimast piletit täpselt samal ajal.

## Kontrollküsimused

1. **Mis juhtub, kui tehingu sees unustada ühele päringule `tx` anda?** See jookseb tehingust väljas ja jääb ROLLBACK-i järel alles.
2. **Miks kontrollid on enne tehingut?** Tehing hoiab ridu lukus: mida lühem, seda parem.
3. **Miks `OrderService` saab `TicketTypeRepository`, mitte `TicketTypeService`-i?** Broneering peab jooksma meie tehingu sees, service'i meetodid `tx`-i ei võta.

## Materjalid

- 📖 [M6 › Tehingud ja konkurents](https://vikatgen.github.io/oppematerjalid/veebirakendused/backend/07-tehingud-ja-konkurents): kõik või mitte midagi, viimane pilet kahele, tingimuslik UPDATE, deadlock
- [Drizzle: Transactions](https://orm.drizzle.team/docs/transactions)
- [PostgreSQL: Transactions](https://www.postgresql.org/docs/current/tutorial-transactions.html)
- [Paul Serban: Drizzle ORM best practices](https://blog.paulserban.eu/post/drizzle-orm-best-practices-principles-patterns-and-real-world-case-studies/)

## Sõltub

- #26
- #27
