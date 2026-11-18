---
title: 27. Tellimuse ja pileti skeem ja migratsioon
milestone: M6 – Tellimused
labels: andmebaas, suurus: M
---

## Eesmärk

`orders` ja `tickets` tabelid on andmebaasis (neljas migratsioon). Üks ost = üks tellimus, milles võib olla mitu piletit (ka eri tüüpi).

## Taust

```
user ──< orders >── events
           │
           └──< tickets >── ticket_types
```

- **Tellimus** seob kasutaja ja ürituse: kes ostis, mis üritusele, kogusumma. **Üks tellimus = üks üritus.**
- **Pilet** on üks rida = üks inimene uksel. Kaks VIP-piletit = kaks rida.
- **`priceCents` piletil = hind OSTU HETKEL.** Kui korraldaja muudab hiljem piletitüübi hinda, ostetud pilet ei muutu. See on **hetktõmmis**, mitte viide.
- **`code`** on juhuslik ja unikaalne (hiljem QR-kood). Mitte järjekorranumber: muidu saaks teiste pileteid ära arvata.
- **Omanik on tellimuse `userId`**, seda piletile ei kopeerita: sama info kahes kohas läheks varem või hiljem lahku.
- **`onDelete: "restrict"` kõikjal:** tellimus on raha ajalugu. Üritust, piletitüüpi ega kasutajat, millel on tellimusi, ei saa kustutada.
- **Olekud kirjeldame kohe kõik**, sest need on tellimuse ja pileti elutsükkel. Postgresi enumile väärtuse lisamine hiljem on tülikam kui veeru lisamine.

  | Tellimus | Tähendus | | Pilet | Tähendus |
  |---|---|---|---|---|
  | `pending` | broneeritud, makse ootel | | `pending` | tellimus makse ootel |
  | `paid` | makstud | | `active` | kehtib |
  | `expired` | makset ei tulnud (#33) | | `cancelled` | tühistatud (#34) või aegunud |
  | | | | `used` | skännitud uksel (#40) |

- Stripe'i makse id ja skännimise info (kes, millal) lisanduvad veergudena siis, kui neid vaja on (#32, #40).

## Sammud

1. `src/db/schema/order.schema.ts`:
   ```ts
   import {sql} from "drizzle-orm";
   import {check, integer, pgEnum, pgTable, uuid, varchar} from "drizzle-orm/pg-core";
   import {timestamps} from "../columns.helpers.js";
   import {user} from "./auth.js";
   import {eventSchema} from "./event.schema.js";
   import {ticketTypeSchema} from "./ticket-type.schema.js";

   export const orderStatusEnum = pgEnum("order_status", ["pending", "paid", "expired"]);

   export const orderSchema = pgTable(
       "orders",
       {
           id: uuid().defaultRandom().primaryKey(),
           userId: uuid()
               .references(() => user.id, {onDelete: "restrict"})
               .notNull(),
           eventId: uuid()
               .references(() => eventSchema.id, {onDelete: "restrict"})
               .notNull(),
           status: orderStatusEnum().notNull().default("pending"),
           totalCents: integer().notNull(),
           ...timestamps,
       },
       (table) => [check("orders_total_check", sql`${table.totalCents} >= 0`)],
   );

   export const ticketStatusEnum = pgEnum("ticket_status", ["pending", "active", "cancelled", "used"]);

   export const ticketSchema = pgTable("tickets", {
       id: uuid().defaultRandom().primaryKey(),
       orderId: uuid()
           .references(() => orderSchema.id, {onDelete: "restrict"})
           .notNull(),
       ticketTypeId: uuid()
           .references(() => ticketTypeSchema.id, {onDelete: "restrict"})
           .notNull(),
       priceCents: integer().notNull(),
       code: varchar({length: 64}).notNull().unique(),
       status: ticketStatusEnum().notNull().default("pending"),
       ...timestamps,
   });

   export type Order = typeof orderSchema.$inferSelect;
   export type CreateOrder = typeof orderSchema.$inferInsert;
   export type Ticket = typeof ticketSchema.$inferSelect;
   export type CreateTicket = typeof ticketSchema.$inferInsert;

   export type OrderWithTickets = Order & {tickets: Ticket[]};
   ```
   - Mõlemad tabelid ühes failis: tellimus ja piletid luuakse ja muudetakse alati koos.
   - `OrderWithTickets`: nii tellimus luuakse ja nii seda näidatakse.
   - `.unique()` `code`-il: andmebaas ei luba kahte sama koodiga piletit.
2. Genereeri ja **loe SQL läbi**:
   ```bash
   npm run db:generate -- --name=create_orders_and_tickets_tables
   ```
   Kas näed kahte uut enumit, `UNIQUE` piirangut ja nelja `FOREIGN KEY`-d `ON DELETE restrict`-iga?
3. ```bash
   npm run db:migrate
   ```
4. Mõtle läbi ja proovi Studios: mis juhtub nüüd mustandi kustutamisel, millele on käsitsi lisatud tellimus? (`restrict` keelab. Päriselt see ei juhtu, sest mustandit ei saa osta.)
5. `npm test`: `tests/setup.ts` tühjendab uued tabelid automaatselt.

## Valmis, kui…

- [ ] `migrations/` kaustas on neljas SQL fail
- [ ] Studios on `orders` ja `tickets` tabelid ning kaks uut enumit
- [ ] `npm test` on roheline

## Mida sa saavutasid

- **Nüüd töötab:** Andmebaasis on tellimuste ja piletite tabelid.
- **Said selgeks:** Üks ost = üks tellimus, milles võib olla mitu piletit. Olekud on enumid, et vigast olekut ei saaks olla.
- **Edasi:** Järgmises sammus kirjutad nendesse tabelitesse ühe tehinguga.

## Kontrollküsimused

1. **Miks piletil on oma `priceCents`, kui piletitüübil on hind olemas?** Hind ostu hetkel ei tohi hiljem muutuda.
2. **Miks `code` on juhuslik, mitte järjekorranumber?** Järjekorranumbriga saaks teiste pileteid ära arvata.
3. **Miks pilet ei hoia `userId`-d?** See on tellimusel: sama info kahes kohas läheks lahku.

## Materjalid

- 📖 [M6 › Andmebaas ja seosed](https://vikatgen.github.io/oppematerjalid/veebirakendused/backend/05-andmebaas-ja-seosed): tabelid, primaar- ja võõrvõti, üks-mitmele ja mitu-mitmele, cascade vs restrict, check
- [Drizzle: Enums](https://orm.drizzle.team/docs/column-types/pg#enum)
- [PostgreSQL: ALTER TYPE (enumi muutmine)](https://www.postgresql.org/docs/current/sql-altertype.html)

## Sõltub

- #24
