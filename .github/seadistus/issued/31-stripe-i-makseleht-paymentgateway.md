---
title: 31. Stripe'i makseleht (PaymentGateway)
milestone: M7 – Stripe
labels: api, suurus: L
---

## Eesmärk

Ost ei ole enam "kohe makstud". `POST /api/orders` broneerib piletid (`pending`), loob **Stripe'i makselehe** ja tagastab selle aadressi. Frontend suunab kasutaja sinna maksma.

```json
201 { "id": "...", "status": "pending", "tickets": [...], "checkoutUrl": "https://checkout.stripe.com/c/pay/cs_test_..." }
```

## Taust

```
POST /api/orders → TEHING (broneering, pending) → Stripe'i makseleht → { ..., checkoutUrl }
kasutaja maksab Stripe'i lehel → Stripe saadab meile webhooki (#32) → paid
```

- **Stripe Checkout:** makseleht on Stripe'i serveris. **Kaardiandmed ei puutu kunagi meie serverit**: me ei pea neid kaitsma ega vastutama.
- **Testirežiim:** `sk_test_...` võti, päris raha ei liigu. Testkaart `4242 4242 4242 4242`, suvaline tulevane kuupäev ja CVC.
- **`PaymentGateway` peidab Stripe'i** (nagu repository peidab andmebaasi). See on ainus fail, mis räägib Stripe'iga. Kui kunagi vahetada Montonio vastu, muutub ainult see fail.
- **Stripe'i kutse on PÄRAST tehingut, mitte selle sees.** Väline päring võib võtta sekundeid ja kogu selle aja hoiaks tehing piletitüüpide ridu lukus.
- **`client_reference_id` = meie tellimuse id.** Webhookis saame selle tagasi ja teame, milline tellimus makstud. Stripe'i makselehe id-d me ei salvesta.
- **Hinnad sentides** (`unit_amount`), nagu meil: teisendust pole vaja.
- **Makstuks märgib tellimuse AINULT webhook (#32), mitte `success_url`.** Kasutaja võib brauseri kinni panna või `success_url`-i ise sisse trükkida.
- `success_url` ja `cancel_url` viivad kasutaja tagasi frontendi: selleks on vaja `FRONTEND_URL`-i. 🟢 Frontendi "Makse tulemus: ootame kinnitust" leht näitab just seda.

## Sammud

1. **Stripe'i konto** (testirežiim): Dashboard → Developers → API keys → kopeeri `sk_test_...`.
2. Paigalda: `npm install stripe`
3. `src/config/env.ts`:
   ```ts
   FRONTEND_URL: z.url(),
   STRIPE_SECRET_KEY: z.string().startsWith("sk_"),
   ```
   `.env`: `FRONTEND_URL=http://localhost:5173` (või `http://localhost:3000`, kui frontendi pole), `STRIPE_SECRET_KEY=sk_test_...`. `.env.example` tühjalt.
   `.env.test`: `FRONTEND_URL=http://localhost:5173`, `STRIPE_SECRET_KEY=sk_test_fake`.
4. `src/payment/stripe.ts`:
   ```ts
   import Stripe from "stripe";
   import {env} from "../config/env.js";

   export const stripe = new Stripe(env.STRIPE_SECRET_KEY);
   ```
   Üks klient kogu rakenduse peale, nagu `db`. Loomine ei tee päringut, seega testides piisab näivvõtmest.
5. `src/payment/payment.gateway.ts`:
   ```ts
   import type Stripe from "stripe";
   import {env} from "../config/env.js";
   import {UnexpectedError} from "../shared/errors/unexpected.error.js";

   export type CheckoutItem = {
       name: string;
       priceCents: number;
       quantity: number;
   };

   const CHECKOUT_EXPIRES_IN_SECONDS = 30 * 60;

   export class PaymentGateway {
       constructor(private readonly stripe: Stripe) {}

       async createCheckout(orderId: string, items: CheckoutItem[]): Promise<string> {
           const session = await this.stripe.checkout.sessions.create({
               mode: "payment",
               client_reference_id: orderId,
               line_items: items.map((item) => ({
                   quantity: item.quantity,
                   price_data: {
                       currency: "eur",
                       unit_amount: item.priceCents,
                       product_data: {name: item.name},
                   },
               })),
               expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_EXPIRES_IN_SECONDS,
               success_url: `${env.FRONTEND_URL}/?payment=success`,
               cancel_url: `${env.FRONTEND_URL}/?payment=cancelled`,
           });

           if (!session.url) {
               throw new UnexpectedError("Stripe ei tagastanud makselehe aadressi");
           }

           return session.url;
       }
   }
   ```
   `expires_at`: makseleht kehtib 30 minutit (Stripe'i miinimum). Nii kaua on piletid broneeritud. Mis saab pärast, vaatame #33-s.
6. `order.service.ts`: konstruktorisse `private readonly paymentGateway: PaymentGateway` ja `create` lõppu makseleht `markPaid` asemel:
   ```ts
   async create(dto: CreateOrderDto, user: AuthUser): Promise<{order: OrderWithTickets; checkoutUrl: string}> {
       const event = await this.eventService.findPublishedById(dto.eventId);
       this.assertSalesOpen(event);
       const ticketTypes = await this.findTicketTypes(dto);

       const order = await this.reserve(dto, user, ticketTypes);
       const checkoutUrl = await this.startCheckout(order, ticketTypes);

       return {order, checkoutUrl};
   }

   private async startCheckout(order: OrderWithTickets, ticketTypes: Map<string, TicketType>): Promise<string> {
       const items: CheckoutItem[] = [...ticketTypes.values()].map((ticketType) => {
           const tickets = order.tickets.filter((ticket) => ticket.ticketTypeId === ticketType.id);
           return {name: ticketType.name, priceCents: tickets[0]!.priceCents, quantity: tickets.length};
       });

       return this.paymentGateway.createCheckout(order.id, items);
   }
   ```
   - Hind tuleb **tellimuse piletitelt** (hetktõmmis), nimi piletitüübilt.
   - Kustuta `markPaid` meetod: makstuks märgib nüüd webhook (#32).
7. `order.controller.ts`:
   ```ts
   const {order, checkoutUrl} = await this.service.create(dto, req.user!);
   res.status(StatusCode.CREATED).json({...toOrderResponse(order), checkoutUrl});
   ```
   `order.routes.ts`: `new OrderService(db, orderRepository, ticketTypeRepository, eventService, new PaymentGateway(stripe))`.
8. **Testid ei kutsu päris Stripe'i** (internet, võtmed, aeglane). `tests/helpers/stripe.ts`:
   ```ts
   import type Stripe from "stripe";
   import {vi} from "vitest";
   import {stripe} from "../../src/payment/stripe.js";

   export const CHECKOUT_URL = "https://checkout.stripe.com/c/pay/cs_test";

   export function mockStripeCheckout() {
       return vi
           .spyOn(stripe.checkout.sessions, "create")
           .mockResolvedValue({url: CHECKOUT_URL} as unknown as Stripe.Response<Stripe.Checkout.Session>);
   }
   ```
   `vi.spyOn` asendab ainult makselehe loomise, ülejäänud kood jookseb päriselt.
   - Kutsu `mockStripeCheckout()` tellimuste testifaili `beforeEach`-is (ja piletitüüpide testides, mis ostavad).
   - Uuenda #28 teste: tellimus on `pending`, piletid `pending`, vastuses on `checkoutUrl`.
   - Uus test: Stripe'ile saadetakse **meie** tellimuse id ja **meie** hinnad (`expect(spy).toHaveBeenCalledWith(expect.objectContaining({client_reference_id: ...}))`).
9. **Proovi päriselt:** seeder → testlehel sisse → konsoolist `POST /api/orders` (Rokiõhtu Tavapilet) → ava `checkoutUrl` → maksa testkaardiga. Stripe Dashboardis (Payments) on makse näha. Meie tellimus jääb `pending`-uks: webhooki veel pole (#32).

## Valmis, kui…

- [ ] Ost tagastab `checkoutUrl`-i ja tellimus on `pending`
- [ ] Testkaardiga makse on Stripe Dashboardis näha
- [ ] Testid ei kutsu päris Stripe'i ja kontrollivad, mida Stripe'ile saadetakse
- [ ] `markPaid` on `create`-ist eemaldatud

## Mida sa saavutasid

- **Nüüd töötab:** Ost loob päris Stripe'i makselehe ja testkaardiga makse on Stripe'i Dashboardis näha.
- **Said selgeks:** Välist teenust kasutatakse liidese (`PaymentGateway`) kaudu, et testid ei kutsuks päris Stripe'i.
- **Edasi:** Pärast makset ei tea meie server veel midagi. Järgmine samm on webhook.

## Kontrollküsimused

1. **Miks makseleht on Stripe'i serveris?** Kaardiandmed ei puutu meie serverit.
2. **Miks Stripe'i kutse on pärast tehingut?** Tehing hoiaks muidu ridu lukus kogu välise päringu aja.
3. **Miks makstuks ei märgi `success_url`?** Kasutaja võib lehe kinni panna või aadressi ise sisse trükkida.

## Materjalid

- 📖 [M6 › Välised teenused: maksed ja webhook](https://vikatgen.github.io/oppematerjalid/veebirakendused/backend/12-valised-teenused): makseleht, webhook ja allkiri, miks brauseri tagasitulekut ei usaldata, korduskindlus, gateway
- [Stripe: Checkout quickstart](https://docs.stripe.com/checkout/quickstart)
- [Stripe API: Create a Checkout Session](https://docs.stripe.com/api/checkout/sessions/create)
- [Stripe: Testing (testkaardid)](https://docs.stripe.com/testing)
- [Stripe: Automated testing](https://docs.stripe.com/automated-testing)

## Sõltub

- #30
