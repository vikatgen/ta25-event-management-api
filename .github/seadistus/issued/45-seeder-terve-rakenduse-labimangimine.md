---
title: 45. Seeder: terve rakenduse läbimängimine
milestone: M10 – Kvaliteet
labels: andmebaas, suurus: M
---

## Eesmärk

`npm run seed -- sinu@gmail.com` loob andmed, millega saab **terve rakenduse läbi mängida** igas rollis. Seeder kontrollib lõpus ise, et andmed on omavahel kooskõlas, ja trükib kokkuvõtte: kes on kes ja mida proovida.

## Taust

Seeder on kasvanud koos rakendusega (#20, #26, #30, #32, #38, #40). Nüüd lisame puuduvad olukorrad ja kontrolli.

**Mis on juba olemas:**

| Olukord | Kus |
|---|---|
| kasutajad kõigis rollides, päris kasutaja admin | #20 |
| üritused kõigis olekutes, müük pole alanud, algab varsti | #20 |
| piletitüübid, välja müüdud VIP (Rokiõhtu) | #26, #30 |
| makstud, ootel ja aegunud tellimus | #30, #32 |
| turvamees kahel üritusel | #38 |
| kasutatud ja kehtiv pilet tänasel üritusel | #40 |

**Mis lisandub:**

| Olukord | Mida sellega proovida |
|---|---|
| ostja tühistatud pilet (raha tagastatud) | "Minu piletid" näitab tühistatud piletit, QR-i pole |
| tühistatud üritus, mille piletid on tagastatud | korraldaja vaade, ostja ajalugu |

**Kooskõla:** `sold` peab võrduma `pending` + `active` + `used` piletite arvuga (tühistatud ja aegunud ei loe). Kui seederisse tekib viga (nt keegi lisab piletid ilma `sold`-i suurendamata), peab seeder seda ise märkama.

## Sammud

1. `src/scripts/seed.ts`, abifunktsioon tühistamiseks (`createOrder`-i järele):
   ```ts
   async function cancelTicket(ticket: Ticket) {
       await db.update(ticketSchema).set({status: "cancelled"}).where(eq(ticketSchema.id, ticket.id));
       await db
           .update(ticketTypeSchema)
           .set({sold: sql`${ticketTypeSchema.sold} - 1`})
           .where(eq(ticketTypeSchema.id, ticket.ticketTypeId));
   }
   ```
   Sama, mida teeb päris tagasimakse (#35), ainult ilma Stripe'ita.
2. Uued olukorrad (tellimuste juurde):
   ```ts
   const cancelledConcert = eventByTitle("Tühistatud kontsert");

   // Ostja tühistas ühe oma Rokiõhtu pileti
   const [cancelledTicket] = await createOrder(
       attendeeB.id,
       rock.id,
       [{ticketType: typeOf("Rokiõhtu", "Tavapilet"), quantity: 1}],
       "paid",
   );
   if (cancelledTicket) await cancelTicket(cancelledTicket);

   // Üritus tühistati pärast müüki: kõik piletid on tagastatud
   const refundedTickets = await createOrder(
       attendeeA.id,
       cancelledConcert.id,
       [{ticketType: typeOf("Tühistatud kontsert", "Tavapilet"), quantity: 2}],
       "paid",
   );
   for (const ticket of refundedTickets) await cancelTicket(ticket);
   ```
3. **Kooskõla kontroll** (enne `pool.end()`):
   ```ts
   const mismatches = await db.execute<{name: string; sold: number; tickets: string}>(sql`
       SELECT tt.name, tt.sold, COUNT(t.id) FILTER (WHERE t.status IN ('pending', 'active', 'used')) AS tickets
       FROM ticket_types tt
       LEFT JOIN tickets t ON t.ticket_type_id = tt.id
       GROUP BY tt.id
       HAVING tt.sold <> COUNT(t.id) FILTER (WHERE t.status IN ('pending', 'active', 'used'))
   `);

   if (mismatches.rows.length > 0) {
       console.error("sold ei klapi piletitega:", mismatches.rows);
       process.exit(1);
   }
   ```
   - Siin on toores SQL, sest `COUNT(...) FILTER (...)` on Drizzle'i päringuehitajaga tülikas. `db.execute` + `sql` on selleks olemas.
   - `COUNT` tagastab Postgresis `bigint`-i, mis tuleb JavaScripti stringina: seepärast `tickets: string`.
   - Proovi: kommenteeri `cancelTicket`-is `sold - 1` välja → seeder peab kukkuma. Pane tagasi.
4. **Kokkuvõte** (kõige lõppu, enne `pool.end()`):
   ```ts
   console.table([
       {roll: "admin", kes: realUserEmail ?? "admin@seed.test (sisse logida ei saa)"},
       {roll: "organizer", kes: "organizer-a@seed.test, organizer-b@seed.test"},
       {roll: "security", kes: "security@seed.test (Rokiõhtu, Elektroonilise muusika öö)"},
       {roll: "attendee", kes: "attendee-a@seed.test, attendee-b@seed.test"},
   ]);
   ```
5. **README: "Läbimängimine".** Kirjuta tabel, mida igas rollis proovida. Kuna seeditud kasutajad ei saa sisse logida, vaheta oma rolli adminina (`PATCH /api/admin/users/:id/role`, #37) või kasuta teist Google'i kontot:

   | Roll | Proovi |
   |---|---|
   | külastaja (sisselogimata) | avalik nimekiri, Rokiõhtu VIP `available: 0`, Tehnoloogiakonverentsi müük pole alanud |
   | attendee | osta Jazzi õhtu pilet testkaardiga, tühista see, vaata QR-i |
   | organizer | avalda Suvefestival, muuda piletitüüpe, lisa turvamees, tühista üritus (worker teeb tagasimaksed) |
   | security | skänni "Elektroonilise muusika öö" kehtiv pilet, proovi kasutatud piletit uuesti |
   | admin | muuda rolle, vaata kõiki üritusi |

6. Käivita kaks korda järjest: mõlemad lõpevad kokkuvõttega ja kooskõla kontroll ei kurda.

## Valmis, kui…

- [ ] Seederis on iga pileti ja tellimuse olek ning iga ürituse olek
- [ ] Kooskõla kontroll märkab `sold` vea ja peatab seederi
- [ ] Seeder trükib kokkuvõtte rollidest
- [ ] README-s on läbimängimise juhend iga rolli kohta

## Mida sa saavutasid

- **Nüüd töötab:** Ühe käsuga saad andmed, millega mängida terve rakendus läbi igas rollis, ja seeder kontrollib ise andmete kooskõla.
- **Said selgeks:** Testandmed on tööriist: hea seeder näitab kõiki olekuid ja ütleb, mida proovida.
- **Edasi:** Mängi README juhendi järgi rakendus läbi. See on parim kordamine kõigest, mis tehtud.

## Kontrollküsimused

1. **Miks seeder kontrollib ise kooskõla?** Vigased näidisandmed annaksid vigu, mis päriselt ei juhtu, ja need on raske leida.
2. **Miks `used` pilet loeb `sold`-i hulka?** See müüdi; `sold` väheneb ainult tühistamisel ja aegumisel.

## Materjalid

- [PostgreSQL: Aggregate FILTER](https://www.postgresql.org/docs/current/sql-expressions.html#SYNTAX-AGGREGATES)
- [Drizzle: db.execute](https://orm.drizzle.team/docs/sql#sql-in-execute)

## Sõltub

- #44
