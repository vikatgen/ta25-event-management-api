---
title: 32. Stripe'i webhook: makse kinnitus
milestone: M7 – Stripe
labels: api, suurus: L
---

## Eesmärk

Kui kasutaja maksab, teatab Stripe sellest meie serverile (**webhook**). Tellimus läheb `paid`, piletid `active` ja Stripe'i makse id salvestub (viies migratsioon: seda on vaja tagasimakseks, #34).

## Taust

```
Stripe ──POST /api/payments/webhook + stripe-signature päis──► meie server
   allkiri õige? ── ei ──► 400
        │ jah
   checkout.session.completed (paid) ──► tellimus paid, piletid active
```

- **Webhook** = teine server teeb päringu **meile**. `requireAuth`-i siin pole: Stripe ei ole sisse logitud kasutaja.
- **Kaitse on allkiri.** Stripe allkirjastab iga päringu saladusega (`whsec_...`). Ilma kontrollita saaks igaüks, kes teab meie aadressi, saata "makstud" sündmuse ja saada tasuta piletid.
- **Allkiri arvutatakse TÄPSELT nendest baitidest, mis Stripe saatis.** `express.json()` teeks kehast objekti ja allkiri ei klapiks enam. Seepärast `express.raw()` ja webhooki router on `app.ts`-is **ENNE** `express.json()`-it (sama põhjus mis Better Authil, #8).
- **Korduskindlus (idempotency):** Stripe võib sama sündmuse saata mitu korda (nt kui me ei vastanud õigel ajal). `WHERE status = 'pending'` (#28): teine kord ei leia midagi. **Webhookis ei viska me siis viga**: `409` peale saadaks Stripe sama sündmust aina uuesti. Vastame alati `200`.
- **Pangamakse:** `completed` võib tulla ka siis, kui raha pole veel laekunud (`payment_status: "unpaid"`). Siis ootame `async_payment_succeeded` sündmust.
- **`stripe listen`** suunab Stripe'i webhookid sinu arvuti `localhost`-ile: avalikku serverit pole vaja.

## Sammud

1. **Stripe CLI:** `brew install stripe/stripe-cli/stripe` (või vt materjalid), siis `stripe login`.
2. `package.json`:
   ```json
   "stripe:listen": "stripe listen --events checkout.session.completed,checkout.session.expired,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed --forward-to localhost:3000/api/payments/webhook",
   "stripe:secret": "stripe listen --print-secret"
   ```
   `npm run stripe:secret` → kopeeri `whsec_...` `.env`-i.
3. `src/config/env.ts`: `STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_")`. `.env.test`: `STRIPE_WEBHOOK_SECRET=whsec_test_fake`.
4. **Skeem:** `order.schema.ts`, `orders` tabelisse `totalCents` järele:
   ```ts
   stripePaymentIntentId: varchar({length: 255}),
   ```
   `null` = pole veel makstud. Tagasimakse (#34) vajab seda id-d.
   ```bash
   npm run db:generate -- --name=add_stripe_payment_intent_to_orders
   npm run db:migrate
   ```
5. `order.repository.ts`: `markPaid(id, stripePaymentIntentId, tx?)` ja `.set({status: "paid", stripePaymentIntentId})`.
6. `order.service.ts`, uus `markPaid` (korduskindel, viga ei viska):
   ```ts
   async markPaid(orderId: string, stripePaymentIntentId: string): Promise<void> {
       await this.db.transaction((tx) => this.orderRepository.markPaid(orderId, stripePaymentIntentId, tx));
   }
   ```
   Tehing, sest muutuvad kaks tabelit (tellimus ja piletid).
7. `payment.gateway.ts`, lisa meetod:
   ```ts
   parseWebhookEvent(rawBody: Buffer, signature: string | undefined): Stripe.Event | undefined {
       if (!signature) {
           return undefined;
       }

       try {
           return this.stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
       } catch {
           return undefined;
       }
   }
   ```
8. `src/payment/payment.service.ts`:
   ```ts
   import type Stripe from "stripe";
   import type {OrderService} from "../order/order.service.js";
   import {BadRequestError} from "../shared/errors/http.errors.js";
   import type {PaymentGateway} from "./payment.gateway.js";

   export class PaymentService {
       constructor(
           private readonly paymentGateway: PaymentGateway,
           private readonly orderService: OrderService,
       ) {}

       async handleWebhook(rawBody: Buffer, signature: string | undefined): Promise<void> {
           const event = this.paymentGateway.parseWebhookEvent(rawBody, signature);

           if (!event) {
               throw new BadRequestError("Vigane Stripe'i allkiri");
           }

           switch (event.type) {
               case "checkout.session.completed":
                   if (event.data.object.payment_status === "paid") {
                       await this.markPaid(event.data.object);
                   }
                   break;

               case "checkout.session.async_payment_succeeded":
                   await this.markPaid(event.data.object);
                   break;
           }
       }

       private async markPaid(session: Stripe.Checkout.Session): Promise<void> {
           if (session.client_reference_id && typeof session.payment_intent === "string") {
               await this.orderService.markPaid(session.client_reference_id, session.payment_intent);
           }
       }
   }
   ```
   - `switch (event.type)`: TypeScript teab siis, et `event.data.object` on makseleht (`Checkout.Session`).
   - Muud sündmused ei huvita meid, aga vastame ikka `200`, muidu Stripe saadab neid uuesti.
   - `client_reference_id` puudub → makseleht pole meie loodud, ignoreerime.
9. `payment.controller.ts`:
   ```ts
   webhook: RequestHandler = async (req, res) => {
       await this.service.handleWebhook(req.body, req.header("stripe-signature"));
       res.json({received: true});
   };
   ```
   `payment.routes.ts`:
   ```ts
   const paymentGateway = new PaymentGateway(stripe);
   const paymentService = new PaymentService(paymentGateway, orderService);
   const paymentController = new PaymentController(paymentService);

   export const paymentRouter = Router();

   paymentRouter.post("/webhook", express.raw({type: "application/json"}), paymentController.webhook);
   ```
   `order.routes.ts`: `export const orderService = ...`.
10. `src/app.ts`, **enne** `app.use(express.json())`:
    ```ts
    app.use("/api/payments", paymentRouter);
    ```
11. Testid. `tests/helpers/stripe.ts`, webhook õige allkirjaga:
    ```ts
    export function sendStripeWebhook(
        type: string,
        session: {client_reference_id: string; payment_status?: string; payment_intent?: string},
    ) {
        const payload = JSON.stringify({
            id: "evt_test",
            object: "event",
            type,
            data: {object: {object: "checkout.session", payment_status: "paid", payment_intent: "pi_test", ...session}},
        });
        const signature = stripe.webhooks.generateTestHeaderString({payload, secret: env.STRIPE_WEBHOOK_SECRET});

        return request(app)
            .post("/api/payments/webhook")
            .set("Content-Type", "application/json")
            .set("stripe-signature", signature)
            .send(payload);
    }
    ```
    `tests/helpers/api.ts`: `buyPaidTickets(quantity, ticketType)` → ost + `completed` webhook, tagastab `{organizer, event, ticketType, buyer, tickets}`.
    `tests/payment/payment.routes.test.ts`: allkiri puudub → `400`, võltsitud allkiri → `400` ja tellimus jääb `pending`, `completed` → tellimus `paid` ja piletid `active`, sama sündmus kaks korda → `200` mõlemal, `payment_status: "unpaid"` → jääb `pending`, muu sündmus → `200` ja midagi ei muutu.
12. **Seeder:** `createOrder`-is (#30) lisa makstud tellimusele näiv makse id:
    ```ts
    const stripePaymentIntentId = status === "paid" ? `pi_seed_${crypto.randomUUID()}` : null;
    const [order] = await db.insert(orderSchema).values({userId, eventId, status, totalCents, stripePaymentIntentId}).returning();
    ```
    > ⚠️ Need id-d ei ole Stripe'is olemas. Seeditud piletite tagasimakse (#34) Stripe'i vastu ei õnnestu: tühistamise proovimiseks osta pilet päriselt testkaardiga.
13. **Proovi päriselt:** kolm terminali: `npm run server`, `npm run stripe:listen`, ja ost testkaardiga (#31). `stripe:listen` terminalis on näha `checkout.session.completed → 200`, Studios on tellimus `paid` ja `stripe_payment_intent_id` täidetud.

## Valmis, kui…

- [ ] Päris makse testkaardiga märgib tellimuse `paid` ja piletid `active`
- [ ] Vale või puuduv allkiri annab `400`
- [ ] Sama sündmus kaks korda ei anna viga ega muuda midagi teist korda
- [ ] `stripe_payment_intent_id` on makstud tellimusel täidetud
- [ ] Testid on rohelised

## Mida sa saavutasid

- **Nüüd töötab:** Kui ostja maksab, teatab Stripe meie serverile ning tellimus ja piletid lähevad kehtima.
- **Said selgeks:** Webhook = teenus helistab sulle tagasi. Allkiri tõestab, et teade tuli päriselt Stripe'ilt. **Idempotentsus**: sama sündmus kaks korda ei tee kahju.
- **Edasi:** Järgmine samm lahendab olukorra, kus ostja jätab maksmata.

## Kontrollküsimused

1. **Miks webhookil pole `requireAuth`-i?** Stripe ei ole sisse logitud kasutaja. Kaitse on allkiri.
2. **Miks `express.raw()`, mitte `express.json()`?** Allkiri arvutatakse algsetest baitidest.
3. **Miks korduv sündmus ei anna `409`?** Stripe saadaks seda siis aina uuesti.

## Materjalid

- 📖 [M6 › Välised teenused: maksed ja webhook](https://vikatgen.github.io/oppematerjalid/veebirakendused/backend/12-valised-teenused): makseleht, webhook ja allkiri, miks brauseri tagasitulekut ei usaldata, korduskindlus, gateway
- [Stripe: Fulfill orders](https://docs.stripe.com/checkout/fulfillment)
- [Stripe: Set up events (Express näide)](https://docs.stripe.com/events/set-up-events)
- [Stripe CLI: stripe listen](https://docs.stripe.com/cli/listen)
- [Stripe: Signature errors](https://docs.stripe.com/events/manage-webhook-endpoints#signature-errors)

## Sõltub

- #31
