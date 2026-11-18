---
title: 33. Aegumine ja üks makse ootel tellimus
milestone: M7 – Stripe
labels: api, suurus: L
---

## Eesmärk

Kui kasutaja ei maksa 30 minuti jooksul, **vabastatakse broneeritud piletid** teistele. Üks kasutaja ei saa ühe ürituse kohta hoida mitut makse ootel tellimust (kuues migratsioon: osaline unikaalne indeks).

## Taust

**Aegumine on ostu vastupidine tehing:**

```
ost:      reserve (sold + n) → tellimus pending → piletid pending
aegumine: tellimus expired → piletid cancelled → release (sold - n)
```

- Stripe saadab `checkout.session.expired`, kui makseleht aegub (meie `expires_at`, #31). Sama teeme ka `async_payment_failed` korral (pangamakse ebaõnnestus).
- **Korduskindel:** `WHERE status = 'pending'`. Kui sündmus tuleb kaks korda, ei vähendata `sold`-i teist korda. Makstud tellimus ei saa aeguda.
- **Kui Stripe'i kutse ise kukub** (#31 `startCheckout`), on piletid juba broneeritud, aga makselehte ei tekkinud. Stripe ei saada siis ka aegumise sündmust: vabastame piletid ise ja viskame vea edasi (`500`).
- **Bot-broneeringud (OWASP API6):** ilma piiranguta saaks bot broneerida kõik piletid ja mitte maksta. Iga tellimus hoiab kohti 30 min, siis uus tellimus jne. Lahendus: **üks makse ootel tellimus kasutaja ja ürituse kohta.**
  - Service kontrollib enne (`hasPending`): selge veateade.
  - Andmebaasi **osaline unikaalne indeks** (`WHERE status = 'pending'`) on viimane kaitse kahe samaaegse päringu vastu (sama probleem mis #29-s). Makstud ja aegunud tellimusi võib olla palju, ainult `pending` peab olema unikaalne.
  - Unikaalsuse rikkumine annab Postgresi vea koodiga `23505`. `errorHandler` teeb sellest `409`, mitte `500`.

## Sammud

1. `ticket-type.repository.ts`:
   ```ts
   async release(eventId: string, id: string, quantity: number, tx?: Transaction): Promise<void> {
       const db = tx ?? this.db;
       await db
           .update(ticketTypeSchema)
           .set({sold: sql`${ticketTypeSchema.sold} - ${quantity}`})
           .where(and(eq(ticketTypeSchema.id, id), eq(ticketTypeSchema.eventId, eventId)));
   }
   ```
   Üks lause, nagu `reserve`: samaaegne ost ei lähe kaduma.
2. `order.repository.ts`: `markPaid` ja uus `markExpired` teevad sama asja eri väärtustega. Tõsta ühisosa privaatsesse meetodisse:
   ```ts
   async markPaid(id: string, stripePaymentIntentId: string, tx?: Transaction): Promise<OrderWithTickets | undefined> {
       return this.finishPending(id, {status: "paid", stripePaymentIntentId}, "active", tx);
   }

   async markExpired(id: string, tx?: Transaction): Promise<OrderWithTickets | undefined> {
       return this.finishPending(id, {status: "expired"}, "cancelled", tx);
   }

   private async finishPending(
       id: string,
       changes: Pick<CreateOrder, "status" | "stripePaymentIntentId">,
       ticketStatus: Ticket["status"],
       tx?: Transaction,
   ): Promise<OrderWithTickets | undefined> {
       const db = tx ?? this.db;

       const [order] = await db
           .update(orderSchema)
           .set(changes)
           .where(and(eq(orderSchema.id, id), eq(orderSchema.status, "pending")))
           .returning();

       if (!order) {
           return undefined;
       }

       const tickets = await db
           .update(ticketSchema)
           .set({status: ticketStatus})
           .where(eq(ticketSchema.orderId, id))
           .returning();

       return {...order, tickets};
   }

   async hasPending(userId: string, eventId: string): Promise<boolean> {
       const [order] = await this.db
           .select({id: orderSchema.id})
           .from(orderSchema)
           .where(and(eq(orderSchema.userId, userId), eq(orderSchema.eventId, eventId), eq(orderSchema.status, "pending")))
           .limit(1);
       return order !== undefined;
   }
   ```
3. `order.service.ts`:
   ```ts
   async expire(orderId: string): Promise<void> {
       await this.db.transaction(async (tx) => {
           const order = await this.orderRepository.markExpired(orderId, tx);

           if (!order) {
               return;
           }

           const quantities = new Map<string, number>();
           for (const ticket of order.tickets) {
               quantities.set(ticket.ticketTypeId, (quantities.get(ticket.ticketTypeId) ?? 0) + 1);
           }

           for (const ticketTypeId of [...quantities.keys()].sort()) {
               await this.ticketTypeRepository.release(order.eventId, ticketTypeId, quantities.get(ticketTypeId)!, tx);
           }
       });
   }
   ```
   - `Map`: mitu piletit iga tüübi kohta (`{"tavapilet-id": 2, "vip-id": 1}`).
   - `.sort()`: sama põhjus mis `reserve`-is (#29, deadlock).

   `startCheckout` (#31): kui Stripe kukub, vabasta broneering:
   ```ts
   try {
       return await this.paymentGateway.createCheckout(order.id, items);
   } catch (error) {
       await this.expire(order.id);
       throw error;
   }
   ```
   `create`-is enne `reserve`-i:
   ```ts
   if (await this.orderRepository.hasPending(user.id, dto.eventId)) {
       throw new ConflictError("Sul on selle ürituse kohta juba makse ootel tellimus");
   }
   ```
4. `payment.service.ts`, `switch`-i:
   ```ts
   case "checkout.session.expired":
   case "checkout.session.async_payment_failed":
       await this.expire(event.data.object.client_reference_id);
       break;
   ```
   ja
   ```ts
   private async expire(orderId: string | null): Promise<void> {
       if (orderId) {
           await this.orderService.expire(orderId);
       }
   }
   ```
5. **Skeem:** `order.schema.ts`, `orders` tabeli kolmandasse argumenti:
   ```ts
   (table) => [
       check("orders_total_check", sql`${table.totalCents} >= 0`),
       uniqueIndex("orders_one_pending_per_user_event")
           .on(table.userId, table.eventId)
           .where(sql`${table.status} = 'pending'`),
   ],
   ```
   ```bash
   npm run db:generate -- --name=one_pending_order_per_user_event
   npm run db:migrate
   ```
   Loe SQL läbi: `CREATE UNIQUE INDEX ... WHERE "orders"."status" = 'pending'`.
6. `error.middleware.ts`, enne `HttpError` kontrolli:
   ```ts
   if (err.cause?.code === "23505") {
       res.status(StatusCode.CONFLICT).json({error: "Konflikt andmete praeguse olekuga"});
       return;
   }
   ```
   Drizzle paneb Postgresi vea `cause` sisse. `23505` = `unique_violation`.
7. Testid:
   - `payment.routes.test.ts`: `expired` → tellimus `expired`, piletid `cancelled`, `sold` tagasi; sama sündmus kaks korda → `sold` ei vähene teist korda; makstud tellimus ei aegu
   - `order.routes.test.ts`: Stripe kukub (`vi.spyOn(...).mockRejectedValue(new Error("Stripe maas"))`) → `500` ja `sold` on tagasi `0`; teine ootel tellimus samale üritusele → `409`; kaks samaaegset tellimust samalt kasutajalt (`Promise.all`) → `[201, 409]`
8. **Proovi päriselt:** loo tellimus, ava makseleht, ära maksa. Aegumist ei pea 30 min ootama:
   ```bash
   stripe checkout sessions expire cs_test_...
   ```
   (`cs_test_...` on `checkoutUrl`-is). `stripe:listen` näitab `checkout.session.expired → 200`, piletid on jälle saadaval.
9. **Seeder:** ootel ja aegunud tellimused on juba olemas (#30). Kontrolli, et `npm run seed` töötab uue indeksiga (ühel kasutajal pole sama ürituse kohta kahte `pending` tellimust).

## Valmis, kui…

- [ ] Aegunud makseleht vabastab piletid ja `sold` väheneb täpselt üks kord
- [ ] Stripe'i kukkumisel vabastatakse broneering ise
- [ ] Teine ootel tellimus samale üritusele annab `409`, ka samaaegselt
- [ ] Testid on rohelised ja `npm run seed` töötab

## Mida sa saavutasid

- **Nüüd töötab:** Maksmata tellimus aegub ja piletid vabanevad teistele. Üks kasutaja ei saa hoida mitut ootel tellimust.
- **Said selgeks:** Broneeringul on aegumisaeg ja osaline unikaalne indeks paneb reegli kirja andmebaasi.
- **Edasi:** Ostmine on nüüd lõpuni valmis. Järgmine verstapost viib raha tagasi.

## Kontrollküsimused

1. **Miks aegumine on tehing?** Muutuvad tellimus, piletid ja piletitüübid: kõik või mitte midagi.
2. **Miks on vaja nii `hasPending` kontrolli kui ka unikaalset indeksit?** Kontroll annab selge teate, indeks kaitseb samaaegsete päringute eest.
3. **Miks indeks on osaline (`WHERE status = 'pending'`)?** Makstud ja aegunud tellimusi võib samal kasutajal olla mitu.

## Materjalid

- 📖 [M6 › Tehingud ja konkurents](https://vikatgen.github.io/oppematerjalid/veebirakendused/backend/07-tehingud-ja-konkurents): kõik või mitte midagi, viimane pilet kahele, tingimuslik UPDATE, deadlock
- 📖 [M6 › Välised teenused: maksed ja webhook](https://vikatgen.github.io/oppematerjalid/veebirakendused/backend/12-valised-teenused): makseleht, webhook ja allkiri, miks brauseri tagasitulekut ei usaldata, korduskindlus, gateway
- [Stripe API: Expire a session](https://docs.stripe.com/api/checkout/sessions/expire)
- [PostgreSQL: Partial indexes](https://www.postgresql.org/docs/current/indexes-partial.html)
- [PostgreSQL: Error codes](https://www.postgresql.org/docs/current/errcodes-appendix.html)
- [OWASP API6: Unrestricted Access to Sensitive Business Flows](https://owasp.org/API-Security/editions/2023/en/0xa6-unrestricted-access-to-sensitive-business-flows/)

## Sõltub

- #32
