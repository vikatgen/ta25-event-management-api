---
title: 29. Konkurents: viimane pilet ainult ühele ja deadlock
milestone: M6 – Tellimused
labels: test, suurus: M
---

## Eesmärk

Tõestame testiga, et **viimast piletit ei saa müüa kahele**, ka siis, kui kaks ostjat vajutavad "Osta" täpselt samal ajal. Mõistame, miks broneerimine on üks SQL-lause, ja väldime deadlock'i.

## Taust

**Naiivne lahendus ("loe, kontrolli, kirjuta"):**

```
Ostja A: SELECT sold → 99         Ostja B: SELECT sold → 99
Ostja A: 99 < 100 ✅               Ostja B: 99 < 100 ✅
Ostja A: UPDATE sold = 100        Ostja B: UPDATE sold = 100
→ kaks piletit müüdud, sold = 100, aga 101 inimest uksel
```

Mõlemad lugesid sama väärtuse enne, kui teine jõudis kirjutada. Seda nimetatakse **race condition**'iks.

**Meie lahendus (#28): kontroll ja muutmine on ÜKS lause.**

```sql
UPDATE ticket_types SET sold = sold + 1 WHERE id = ? AND sold + 1 <= capacity RETURNING *
```

Postgres lukustab rea `UPDATE`-i ajaks. Teine ostja **ootab**, kuni esimese tehing lõpeb, ja näeb siis juba `sold = 100`: tingimus ei kehti, ridu ei muutu → `undefined` → `409`.

**Deadlock:** ostja A korvis on [Tavapilet, VIP], ostja B korvis [VIP, Tavapilet]. A lukustab Tavapileti ja ootab VIP-i, B lukustab VIP-i ja ootab Tavapiletit: mõlemad ootavad igavesti (Postgres katkestab ühe veaga). **Lahendus:** lukusta read alati samas järjekorras, sorteerides need `ticketTypeId` järgi.

Samaaegsust testime `Promise.all`-iga: kaks päringut saadetakse korraga, mitte järjest.

## Sammud

1. Kirjuta test `tests/order/order.routes.test.ts`-i:
   ```ts
   it("müüb viimase pileti ainult ühele, kui kaks ostjat ostavad seda samal ajal", async () => {
       const {event, ticketTypes: [ticketType]} = await createOnSaleEvent([{capacity: 1}]);
       const buyerA = await loginAs("attendee");
       const buyerB = await loginAs("attendee");
       const body = orderBody(event.id, [{ticketTypeId: ticketType.id, quantity: 1}]);

       const responses = await Promise.all([
           request(app).post("/api/orders").set("Cookie", buyerA.cookie).send(body),
           request(app).post("/api/orders").set("Cookie", buyerB.cookie).send(body),
       ]);

       const statuses = responses.map((response) => response.status).sort();
       expect(statuses).toEqual([201, 409]);
   });
   ```
   `.sort()`: me ei tea, kumb jõuab ette, aga üks peab saama `201` ja teine `409`.
2. Käivita: roheline.
3. **Katse: kirjuta `reserve` ajutiselt naiivseks** (`ticket-type.repository.ts`):
   ```ts
   async reserve(eventId: string, id: string, quantity: number, tx?: Transaction) {
       const db = tx ?? this.db;
       const ticketType = await this.findById(eventId, id);
       if (!ticketType || ticketType.sold + quantity > ticketType.capacity) return undefined;
       await new Promise((resolve) => setTimeout(resolve, 50));
       const [updated] = await db
           .update(ticketTypeSchema)
           .set({sold: ticketType.sold + quantity})
           .where(eq(ticketTypeSchema.id, id))
           .returning();
       return updated;
   }
   ```
   `setTimeout` teeb "lugemise ja kirjutamise vahe" pikemaks, nagu koormuse all päriselt juhtub. Käivita test: mõlemad saavad `201`. **Pane õige versioon tagasi** ja veendu, et test on jälle roheline.
4. **Deadlock'i vältimine:** `order.service.ts` `reserve` meetodis sorteeri read enne tehingut:
   ```ts
   const items = [...dto.items].sort((a, b) => a.ticketTypeId.localeCompare(b.ticketTypeId));

   return this.db.transaction(async (tx) => {
       // ...
       for (const item of items) {
   ```
   `[...dto.items]`: koopia, et me ei muudaks kliendi saadetud massiivi. Deadlock'i ei saa testis usaldusväärselt tekitada, seega **seda testi pole**: kirjuta koodi juurde lühike kommentaar, et keegi `.sort()`-i ära ei võtaks.
5. Mõtle: kas `check` piirang `sold <= capacity` (#24) oleks naiivse versiooni puhul aidanud? (Jah: teine `UPDATE` oleks kukkunud andmebaasi veaga, aga kliendile `500`, mitte `409`. Viimane kaitse, mitte lahendus.)

## Valmis, kui…

- [ ] Samaaegsuse test on roheline õige `reserve`-iga ja punane naiivsega
- [ ] Naiivne versioon on eemaldatud
- [ ] Korvi read sorteeritakse enne tehingut ja seal on kommentaar, miks

## Mida sa saavutasid

- **Nüüd töötab:** Testiga on tõestatud, et viimast piletit ei saa müüa kahele.
- **Said selgeks:** Võidujooks (race condition): "loe, siis kirjuta" ei ole ohutu. Broneerimine peab olema üks SQL-lause ja lukkude järjekord hoiab deadlock'i ära.
- **Edasi:** See on üks olulisemaid asju, mis backend'is selgeks saab. Sama mõtte juurde tuleme tagasi skännimise juures (samm 40).

## Kontrollküsimused

1. **Miks "loe, kontrolli, kirjuta" ei tööta?** Kaks päringut loevad sama väärtuse enne, kui kumbki kirjutab.
2. **Miks üks `UPDATE ... WHERE` töötab?** Postgres lukustab rea, teine päring ootab ja näeb uut väärtust.
3. **Mis on deadlock ja kuidas sorteerimine aitab?** Kaks tehingut ootavad teineteise lukke. Sama järjekord → ringi ei teki.

## Materjalid

- 📖 [M6 › Tehingud ja konkurents](https://vikatgen.github.io/oppematerjalid/veebirakendused/backend/07-tehingud-ja-konkurents): kõik või mitte midagi, viimane pilet kahele, tingimuslik UPDATE, deadlock
- [PostgreSQL: Explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html)
- [PostgreSQL: Deadlocks](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-DEADLOCKS)
- [MDN: Promise.all](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all)

## Sõltub

- #28
