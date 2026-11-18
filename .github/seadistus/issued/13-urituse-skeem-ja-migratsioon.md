---
title: 13. Ürituse skeem ja migratsioon
milestone: M3 – Üritused
labels: andmebaas, suurus: M
---

## Eesmärk

`events` tabel on andmebaasis ja Drizzle teab selle kuju. See on esimene **meie enda** tabel (teine migratsioon).

## Taust

- **Skeem (TypeScript) on tõe allikas**, migratsioon (SQL) genereeritakse skeemist. Töövoog on sama mis #7-s.
- `organizerId` viitab `user` tabelile (#8). Seepärast ei saanud seda tabelit varem teha: võõrvõti vajab tabelit, kuhu viidata.
- **`onDelete: "restrict"`**: korraldajat ei saa kustutada, kui tal on üritusi. Muidu kaoks koos temaga ka üritused (ja hiljem müüdud piletid).
- **`pgEnum`** on Postgresi tüüp, mis lubab ainult kindlaid väärtusi: `draft`, `published`, `cancelled`, `completed`. Vale väärtus annab andmebaasi vea isegi siis, kui koodis on viga.
- **Kuupäevad `withTimezone: true`:** üritus algab kindlal hetkel, sõltumata sellest, millises ajavööndis server või kasutaja on. 🟢 Frontendis näitasid neid `Intl.DateTimeFormat`-iga Eesti ajas.
- **`$inferSelect` / `$inferInsert`:** tüübid tulevad skeemist, neid ei kirjuta käsitsi. `CreateEvent`-is on `id`, `status` ja ajatemplid valikulised, sest neil on vaikeväärtus.

## Sammud

1. `src/db/columns.helpers.ts` (iga tabel kasutab):
   ```ts
   import {timestamp} from "drizzle-orm/pg-core";

   export const timestamps = {
       updatedAt: timestamp({withTimezone: true}).defaultNow().notNull().$onUpdate(() => new Date()),
       createdAt: timestamp({withTimezone: true}).defaultNow().notNull(),
   };
   ```
   `$onUpdate`: Drizzle paneb `updatedAt`-i iga `UPDATE`-iga ise uueks.
2. `src/db/schema/event.schema.ts`:
   ```ts
   import {pgEnum, pgTable, text, timestamp, uuid, varchar} from "drizzle-orm/pg-core";
   import {timestamps} from "../columns.helpers.js";
   import {user} from "./auth.js";

   export const statusEnum = pgEnum("event_status", ["draft", "published", "cancelled", "completed"]);

   export const eventSchema = pgTable("events", {
       id: uuid().defaultRandom().primaryKey(),
       title: varchar({length: 255}).notNull(),
       description: text().notNull(),
       shortDescription: varchar({length: 500}).notNull(),
       imageUrl: varchar({length: 500}),
       locationName: varchar({length: 255}).notNull(),
       address: varchar({length: 255}).notNull(),
       city: varchar({length: 100}).notNull(),
       startsAt: timestamp({withTimezone: true}).notNull(),
       endsAt: timestamp({withTimezone: true}).notNull(),
       salesStartAt: timestamp({withTimezone: true}).notNull(),
       salesEndAt: timestamp({withTimezone: true}).notNull(),
       status: statusEnum().notNull().default("draft"),
       organizerId: uuid()
           .references(() => user.id, {onDelete: "restrict"})
           .notNull(),
       ...timestamps,
   });

   export type Event = typeof eventSchema.$inferSelect;
   export type CreateEvent = typeof eventSchema.$inferInsert;
   export type EventStatusEnum = (typeof statusEnum.enumValues)[number];
   ```
   - `imageUrl` on ainus väli ilma `notNull()`-ita: pilt on valikuline.
   - `varchar({length})` vs `text()`: pikkuse piir seal, kus see on loomulik (pealkiri). Kirjeldus võib olla pikk.
3. Genereeri ja **loe SQL läbi**:
   ```bash
   npm run db:generate -- --name=create_events_table
   ```
   Kas veerunimed on `snake_case` (`starts_at`)? Kas on `FOREIGN KEY ... REFERENCES "user"("id") ON DELETE restrict`?
4. ```bash
   npm run db:migrate
   npm run db:studio
   ```
5. Proovi Studios käsitsi rida lisada ilma `organizer_id`-ta või olematu kasutaja id-ga: andmebaas ei luba.

## Valmis, kui…

- [ ] `migrations/` kaustas on teine SQL fail
- [ ] Studios on `events` tabel ja `event_status` enum
- [ ] Olematu `organizer_id` annab andmebaasi vea
- [ ] `npm run typecheck` on puhas

## Mida sa saavutasid

- **Nüüd töötab:** Andmebaasis on sinu esimene enda tabel `events`.
- **Said selgeks:** Enum piirab olekud, võõrvõti seob ürituse korraldajaga ja andmebaas ise keeldub vigastest andmetest.
- **Edasi:** Tabel on olemas, aga sinna ei saa veel midagi kirjutada. Järgmised neli sammu ehitavad kihid, mille kaudu andmed tabelisse jõuavad.

## Kontrollküsimused

1. **Miks ei saanud seda tabelit teha enne #8-t?** `organizerId` viitab `user` tabelile, mida polnud.
2. **Mis juhtub, kui proovid kustutada kasutajat, kellel on üritusi?** `restrict` keelab.
3. **Miks `CreateEvent`-is on `status` valikuline?** Sellel on vaikeväärtus `draft`.

## Materjalid

- 📖 [M6 › Andmebaas ja seosed](https://vikatgen.github.io/oppematerjalid/veebirakendused/backend/05-andmebaas-ja-seosed): tabelid, primaar- ja võõrvõti, üks-mitmele ja mitu-mitmele, cascade vs restrict, check
- 📖 [M6 › ORM ja migratsioonid](https://vikatgen.github.io/oppematerjalid/veebirakendused/backend/06-orm-ja-migratsioonid): mida ORM teeb, migratsioon kui andmebaasi versioonihaldus, miks vana migratsiooni ei muudeta
- [Drizzle: PostgreSQL column types](https://orm.drizzle.team/docs/column-types/pg)
- [Drizzle: Indexes & Constraints](https://orm.drizzle.team/docs/indexes-constraints)
- [PostgreSQL: Foreign keys](https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-FK)

## Sõltub

- #8
