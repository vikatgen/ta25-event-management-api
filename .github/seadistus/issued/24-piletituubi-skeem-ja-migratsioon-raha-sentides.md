---
title: 24. Piletitüübi skeem ja migratsioon (raha sentides)
milestone: M5 – Piletitüübid
labels: andmebaas, suurus: M
---

## Eesmärk

`ticket_types` tabel on andmebaasis (kolmas migratsioon). Üritusel võib olla mitu piletitüüpi ("Tavapilet", "VIP"), igal oma hind ja kogus. Andmebaas ise ei luba vigaseid väärtusi.

## Taust

- **Üks-mitmele seos:** üks üritus → mitu piletitüüpi. Piletitüübil on `eventId`, mis viitab `events` tabelile (#13).
- **Raha on täisarv sentides** (`priceCents: 2500` = 25,00 €). Ujukomaarvuga `0.1 + 0.2 = 0.30000000000000004`: raha arvutamisel ei tohi ümardamisvigu tekkida. 🟢 Frontendis tegid `formatMoney(cents)`: see on põhjus.
- **`sold`:** mitu piletit on müüdud. Seda ei muuda korraldaja, vaid ainult ost (#28). Ülejäänud kogus = `capacity - sold`.
- **`check` piirangud:** andmebaas kontrollib reegleid ise, isegi kui koodis on viga.
  - hind ≥ 0 (tasuta pilet on lubatud)
  - kogus > 0
  - `0 ≤ sold ≤ capacity` (ei saa müüa rohkem, kui on)
- **`onDelete: "cascade"`:** kui üritus kustutatakse, lähevad piletitüübid kaasa. See on ohutu, sest kustutada saab ainult mustandit (#17), millel müüke pole.

## Sammud

1. `src/db/schema/ticket-type.schema.ts`:
   ```ts
   import {sql} from "drizzle-orm";
   import {check, integer, pgTable, uuid, varchar} from "drizzle-orm/pg-core";
   import {timestamps} from "../columns.helpers.js";
   import {eventSchema} from "./event.schema.js";

   export const ticketTypeSchema = pgTable(
       "ticket_types",
       {
           id: uuid().defaultRandom().primaryKey(),
           eventId: uuid()
               .references(() => eventSchema.id, {onDelete: "cascade"})
               .notNull(),
           name: varchar({length: 100}).notNull(),
           priceCents: integer().notNull(),
           capacity: integer().notNull(),
           sold: integer().notNull().default(0),
           ...timestamps,
       },
       (table) => [
           check("ticket_types_price_check", sql`${table.priceCents} >= 0`),
           check("ticket_types_capacity_check", sql`${table.capacity} > 0`),
           check("ticket_types_sold_check", sql`${table.sold} >= 0 AND ${table.sold} <= ${table.capacity}`),
       ],
   );

   export type TicketType = typeof ticketTypeSchema.$inferSelect;
   export type CreateTicketType = typeof ticketTypeSchema.$inferInsert;
   ```
   Kolmas argument (`(table) => [...]`) on koht tabeli tasemel piirangutele ja indeksitele.
2. Genereeri ja **loe SQL läbi**:
   ```bash
   npm run db:generate -- --name=create_ticket_types_table
   ```
   Kas näed kolme `CONSTRAINT ... CHECK` rida ja `ON DELETE cascade`?
3. ```bash
   npm run db:migrate
   ```
4. Proovi Studios käsitsi: lisa piletitüüp `capacity = 10`, `sold = 11`. Andmebaas keeldub. Proovi `price_cents = -1`.
5. `tests/environment.test.ts` ei vaja muutmist: `tests/setup.ts` tühjendab uue tabeli automaatselt (#21). Kontrolli `npm test`.

## Valmis, kui…

- [ ] `migrations/` kaustas on kolmas SQL fail
- [ ] Andmebaas keeldub `sold > capacity` ja negatiivse hinnaga reast
- [ ] Mustandi kustutamine kustutab ka selle piletitüübid
- [ ] `npm test` on endiselt roheline

## Mida sa saavutasid

- **Nüüd töötab:** Andmebaasis on piletitüüpide tabel ja vigaseid väärtusi (negatiivne hind, müüdud üle mahu) andmebaas lihtsalt ei luba.
- **Said selgeks:** Raha hoitakse **sentides täisarvuna**, sest ujukomaarvud ei ole täpsed. `CHECK` piirang on viimane kaitseliin.
- **Edasi:** Järgmises sammus teed piletitüüpide haldamise selle mustri järgi, mida ürituste juures õppisid.

## Kontrollküsimused

1. **Miks hind sentides?** Ujukomaarvuga tekivad ümardamisvead.
2. **Miks `check` andmebaasis, kui zod kontrollib niikuinii?** Viimane kaitse: ka koodi viga või käsitsi päring ei saa vigaseid andmeid salvestada.
3. **Miks `cascade` siin on ohutu?** Kustutada saab ainult mustandit, millel müüke pole.

## Materjalid

- 📖 [M6 › Andmebaas ja seosed](https://vikatgen.github.io/oppematerjalid/veebirakendused/backend/05-andmebaas-ja-seosed): tabelid, primaar- ja võõrvõti, üks-mitmele ja mitu-mitmele, cascade vs restrict, check
- [Drizzle: Check constraints](https://orm.drizzle.team/docs/indexes-constraints#check)
- [PostgreSQL: Check constraints](https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-CHECK-CONSTRAINTS)
- [Why not use floats for money](https://stackoverflow.com/questions/3730019/why-not-use-double-or-float-to-represent-currency)

## Sõltub

- #13
