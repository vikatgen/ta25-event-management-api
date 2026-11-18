---
title: 36. Ürituse tühistamine: kõigi piletite tagasimaksed
milestone: M8 – Tühistamine
labels: api, suurus: L
---

## Eesmärk

Kui korraldaja tühistab ürituse (#18), saavad **kõik** ostjad automaatselt raha tagasi. Kui keegi maksab pärast tühistamist (makseleht oli veel lahti), läheb ka tema raha tagasi.

```
POST /api/events/:id/cancel
  → TEHING: üritus cancelled + töö "event-cancelled" järjekorda   → 200 kohe
worker "event-cancelled": leia kõik kehtivad piletid → iga pileti kohta töö "refund-ticket"   (fan-out)
worker "refund-ticket": Stripe + pilet cancelled (#35)
```

## Taust

- **Töö on tehingu osa.** Kui olek muutub, aga töö jääb panemata (või vastupidi), oleks üritus tühistatud ilma tagasimakseteta või tagasimaksed käiks avaldatud ürituse eest. pg-boss oskab töö lisada **meie Drizzle'i tehingu sees** (`fromDrizzle(tx, sql)`): ROLLBACK viib ka töö ära.
- **Stripe'i siin ei kutsuta:** korraldaja saab vastuse kohe, ükskõik mitu piletit müüdud on.
- **Fan-out:** üks töö ("üritus tühistati") → palju töid (üks iga pileti kohta). Iga tagasimakse on eraldi töö: kui üks kukub, proovitakse ainult seda uuesti, mitte kõiki.
- **Kõik tagasimaksed käivad läbi `refund`-i** (#35): üks muster nii ostja kui ka korraldaja tühistamisele.
- **Event moodul ei tea piletitest midagi.** Ta teatab ainult "üritus tühistati". Piletid leiab `TicketService` workeris.
- **Hiline makse:** makseleht oli lahti, korraldaja tühistas ürituse, kasutaja maksis ikkagi. Webhook märgib tellimuse makstuks, näeb, et üritus on tühistatud, ja paneb iga pileti tagasimakse järjekorda (sama tehingu sees).
- **#18 `changeStatus` jaguneb kaheks:** kontroll (`findForStatusChange`) ja muutmine (`updateStatus(id, status, tx?)`), sest tühistamine vajab vahele tehingut.

## Sammud

1. `queues.ts`: lisa `eventCancelled: "event-cancelled"` ja `export type EventCancelledJob = {eventId: string};`. `boss.ts`: `await boss.createQueue(QUEUES.eventCancelled, RETRY_OPTIONS);`
2. `job.queue.ts`:
   ```ts
   import {fromDrizzle, type PgBoss} from "pg-boss";
   import {sql} from "drizzle-orm";
   import type {Transaction} from "../db/index.js";

   async eventCancelled(eventId: string, tx: Transaction): Promise<void> {
       const data: EventCancelledJob = {eventId};
       await this.boss.send(QUEUES.eventCancelled, data, {db: fromDrizzle(tx, sql)});
   }

   async refundTicket(ticketId: string, tx?: Transaction): Promise<void> {
       const data: RefundTicketJob = {ticketId};
       await this.boss.send(QUEUES.refundTicket, data, tx ? {db: fromDrizzle(tx, sql)} : {});
   }
   ```
   `eventCancelled` nõuab `tx`-i (alati tehingus), `refundTicket` võtab selle valikuliselt (ostja tühistamine #35 on ilma).
3. `event.repository.ts`: `update(id, event, tx?)` → `const db = tx ?? this.db;`
4. `event.service.ts`: konstruktorisse `db: Database` ja `jobQueue: JobQueue`. Asenda `changeStatus`:
   ```ts
   async publish(id: string, user: AuthUser): Promise<Event> {
       await this.findForStatusChange(id, user, "draft", "published");
       return this.updateStatus(id, "published");
   }

   async cancel(id: string, user: AuthUser): Promise<Event> {
       await this.findForStatusChange(id, user, "published", "cancelled");

       return this.db.transaction(async (tx) => {
           const cancelled = await this.updateStatus(id, "cancelled", tx);
           await this.jobQueue.eventCancelled(id, tx);
           return cancelled;
       });
   }

   private async findForStatusChange(id: string, user: AuthUser, from: EventStatusEnum, to: EventStatusEnum): Promise<Event> {
       const event = await this.findOwnedById(id, user);

       if (event.status !== from) {
           throw new ConflictError(`Üritust olekus "${event.status}" ei saa muuta olekusse "${to}"`);
       }

       return event;
   }

   private async updateStatus(id: string, status: EventStatusEnum, tx?: Transaction): Promise<Event> {
       const updated = await this.repository.update(id, {status}, tx);

       if (!updated) {
           throw new NotFoundError("Üritust ei leitud");
       }

       return updated;
   }
   ```
   `event.routes.ts`: `new EventService(eventRepository, db, new JobQueue(boss))`.
5. `ticket.repository.ts`:
   ```ts
   async findActiveIdsByEventId(eventId: string): Promise<string[]> {
       const tickets = await this.db
           .select({id: ticketSchema.id})
           .from(ticketSchema)
           .innerJoin(orderSchema, eq(ticketSchema.orderId, orderSchema.id))
           .where(and(eq(orderSchema.eventId, eventId), eq(ticketSchema.status, "active")));
       return tickets.map((ticket) => ticket.id);
   }
   ```
   `ticket.service.ts`:
   ```ts
   async refundAllForEvent(eventId: string): Promise<void> {
       const ticketIds = await this.ticketRepository.findActiveIdsByEventId(eventId);

       for (const ticketId of ticketIds) {
           await this.jobQueue.refundTicket(ticketId);
       }
   }
   ```
6. `src/worker.ts`, teine handler:
   ```ts
   await boss.work<EventCancelledJob>(QUEUES.eventCancelled, async (jobs) => {
       for (const job of jobs) {
           await ticketService.refundAllForEvent(job.data.eventId);
       }
   });
   ```
7. **Hiline makse.** `order.service.ts`: konstruktorisse `jobQueue: JobQueue`, `markPaid`:
   ```ts
   async markPaid(orderId: string, stripePaymentIntentId: string): Promise<void> {
       await this.db.transaction(async (tx) => {
           const order = await this.orderRepository.markPaid(orderId, stripePaymentIntentId, tx);

           if (!order) {
               return;
           }

           const event = await this.eventService.findById(order.eventId);

           if (event.status === "cancelled") {
               for (const ticket of order.tickets) {
                   await this.jobQueue.refundTicket(ticket.id, tx);
               }
           }
       });
   }
   ```
   `order.routes.ts`: lisa `new JobQueue(boss)`.
8. Testid:
   - `tests/event/event.service.test.ts`: `createService` saab ka võlts-`db` (`{transaction: vi.fn(async (callback) => callback("tx"))}`) ja võlts-`jobQueue` (`{eventCancelled: vi.fn()}`). Test: `cancel` kutsub `update(id, {status: "cancelled"}, "tx")` **ja** `eventCancelled(id, "tx")`: sama tehing. `publish` kutsub `update(id, {status: "published"}, undefined)`.
   - `tests/jobs/job.queue.test.ts`: töö jääb järjekorda, kui tehing õnnestub; töö kaob, kui tehing kukub pärast töö lisamist (`throw` tehingu sees)
   - `tests/ticket/event-cancellation.test.ts`, samm-sammult:
     1. tühistamine → `200`, järjekorras `event-cancelled`, Stripe'i ei kutsutud
     2. `ticketService.refundAllForEvent(eventId)` → järjekorras on iga kehtiva pileti `refund-ticket` töö
     3. iga töö `ticketService.refund(...)` → kõik piletid `cancelled`, Stripe kutsuti iga pileti eest
     4. töö panemine ebaõnnestub (`vi.spyOn(boss, "send").mockRejectedValueOnce(...)`) → üritus jääb `published`
     5. hiline makse: tühista üritus, siis `completed` webhook → piletid kohe järjekorras
9. **Proovi päriselt:** osta testkaardiga 2 piletit, tühista üritus korraldajana, vaata workeri terminali ja Stripe Dashboardi (2 osalist tagasimakset).

## Valmis, kui…

- [ ] Ürituse tühistamine vastab kohe ja kõik kehtivad piletid saavad taustal tagasimakse
- [ ] Olekumuutus ja töö on samas tehingus (ROLLBACK test)
- [ ] Hiline makse tühistatud üritusele läheb automaatselt tagasi
- [ ] Testid on rohelised

## Mida sa saavutasid

- **Nüüd töötab:** Ürituse tühistamisel saavad kõik ostjad automaatselt raha tagasi, ka need, kes maksid hiljem.
- **Said selgeks:** Fan-out (üks töö teeb palju väiksemaid töid) ning olekumuutus ja töö samas tehingus.
- **Edasi:** Raha liikumine on valmis. Järgmine verstapost viib ostja uksest sisse.

## Kontrollküsimused

1. **Miks töö lisatakse sama tehingu sees?** Olek ja tagasimaksed ei tohi lahku minna.
2. **Mis on fan-out ja miks iga pilet on eraldi töö?** Üks töö teeb palju töid. Kukkunud tagasimakset korratakse üksi, mitte kõiki.
3. **Miks event moodul ei loe pileteid ise?** Ta ei pea teadma piletitest: ta teatab sündmuse, piletite moodul reageerib.

## Materjalid

- 📖 [M6 › Taustatööd ja järjekorrad](https://vikatgen.github.io/oppematerjalid/veebirakendused/backend/13-taustatood-ja-jarjekorrad): järjekord, worker, uuesti proovimine, fan-out, töö tehingus, idempotency key
- [pg-boss: send with db option](https://timgit.github.io/pg-boss/#/./api/jobs?id=send)
- [Transactional outbox pattern](https://microservices.io/patterns/data/transactional-outbox.html) (taust: sama mõte)

## Sõltub

- #35
