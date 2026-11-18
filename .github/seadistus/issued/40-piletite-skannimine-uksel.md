---
title: 40. Piletite skännimine uksel
milestone: M9 – Uks ja admin
labels: api, suurus: L
---

## Eesmärk

Turvamees skännib uksel QR-koodi: kehtiv pilet läheb läbi (`used`) ja salvestub, kes ja millal skännis. Mittekehtiva pileti korral saab turvamees **põhjuse** ("juba kasutatud kell 19:02", "tühistatud"). Kaheksas migratsioon.

```json
POST /api/scan  { "eventId": "...", "code": "..." }
200 { "ticketId": "...", "ticketType": "VIP", "usedAt": "..." }
409 { "error": "Pilet on juba kasutatud (19:02)" }
```

## Taust

- **Atomaarne, nagu `reserve` ja `cancel`:** kaks turvameest skännivad sama piletit korraga (keegi tegi koodist ekraanipildi). `UPDATE ... SET status = 'used' WHERE id = ? AND status = 'active'` laseb läbi ainult ühe.
- **Põhjusega vastus:** kui `UPDATE` ei leidnud rida, loeme pileti uuesti ja ütleme, miks: kasutatud (koos kellaajaga), tühistatud, makseta. Turvamees saab inimesele selgitada.
- **Kes tohib skännida:** roll `security` (või admin) **ja** see turvamees on lisatud sellele üritusele (`isStaff`, #38). Teise ürituse turvamees saab `403`.
- **Millal:** 2 tundi enne algust kuni ürituse lõpuni. Muidu `409`.
- **Teise ürituse pilet** → `409` ("Pilet on teisele üritusele").
- **Uued veerud `tickets` tabelis:** `usedAt` ja `scannedBy` (viide `user`-ile). Olek `used` oli enumis juba olemas (#27).
- `TicketDetails` (#34) saab juurde `ticketTypeName`: turvamees näeb kohe "VIP".
- 🟢 Frontendi "Piletite skännimine uksel" kasutab seda route'i.

## Sammud

1. **Skeem:** `order.schema.ts`, `tickets` tabelisse `status` järele:
   ```ts
   usedAt: timestamp({withTimezone: true}),
   scannedBy: uuid().references(() => user.id, {onDelete: "restrict"}),
   ```
   `null` = pole veel kasutatud.
   ```bash
   npm run db:generate -- --name=add_ticket_scanning
   npm run db:migrate
   ```
2. `ticket.repository.ts`:
   - `TicketDetails`-i lisa `ticketTypeName: string` ja `selectDetails`-i `ticketTypeName: ticketTypeSchema.name` + `.innerJoin(ticketTypeSchema, eq(ticketSchema.ticketTypeId, ticketTypeSchema.id))`
   - uued meetodid:
   ```ts
   async findByCode(code: string): Promise<TicketDetails | undefined> {
       const [ticket] = await this.selectDetails().where(eq(ticketSchema.code, code));
       return ticket;
   }

   async markUsed(id: string, scannedBy: string): Promise<Ticket | undefined> {
       const [ticket] = await this.db
           .update(ticketSchema)
           .set({status: "used", usedAt: new Date(), scannedBy})
           .where(and(eq(ticketSchema.id, id), eq(ticketSchema.status, "active")))
           .returning();
       return ticket;
   }
   ```
   `ticket.routes.ts`: `export const ticketRepository = ...`
3. `src/scan/dto/scan.dto.ts`: `z.object({eventId: z.uuid(), code: z.string().min(1).max(64)})`. `scan-response.dto.ts`: `toScanResponse(result)` → `ticketId`, `ticketType`, `usedAt` (ISO).
4. `src/scan/scan.service.ts`:
   ```ts
   export type ScanResult = {
       ticketId: string;
       ticketType: string;
       usedAt: Date;
   };

   const SCAN_OPENS_BEFORE_START_MS = 2 * 60 * 60 * 1000;

   export class ScanService {
       constructor(
           private readonly ticketRepository: TicketRepository,
           private readonly eventStaffService: EventStaffService,
           private readonly eventService: EventService,
       ) {}

       async scan(dto: ScanDto, user: AuthUser): Promise<ScanResult> {
           if (!(await this.eventStaffService.isStaff(dto.eventId, user))) {
               throw new ForbiddenError("Sa ei ole selle ürituse turvamees");
           }

           this.assertScanOpen(await this.eventService.findById(dto.eventId));

           const ticket = await this.ticketRepository.findByCode(dto.code);

           if (!ticket) {
               throw new NotFoundError("Piletit ei leitud");
           }

           if (ticket.eventId !== dto.eventId) {
               throw new ConflictError("Pilet on teisele üritusele");
           }

           const used = await this.ticketRepository.markUsed(ticket.id, user.id);

           if (!used) {
               const current = await this.ticketRepository.findById(ticket.id);
               throw new ConflictError(this.reason(current ?? ticket));
           }

           return {ticketId: used.id, ticketType: ticket.ticketTypeName, usedAt: used.usedAt!};
       }

       private assertScanOpen(event: Event): void {
           const now = Date.now();
           const opensAt = event.startsAt.getTime() - SCAN_OPENS_BEFORE_START_MS;

           if (now < opensAt || now > event.endsAt.getTime()) {
               throw new ConflictError("Skännimine ei ole praegu avatud");
           }
       }

       private reason(ticket: TicketDetails): string {
           switch (ticket.status) {
               case "used": {
                   const time = ticket.usedAt?.toLocaleTimeString("et-EE", {
                       hour: "2-digit",
                       minute: "2-digit",
                       timeZone: "Europe/Tallinn",
                   });
                   return `Pilet on juba kasutatud (${time})`;
               }
               case "cancelled":
                   return "Pilet on tühistatud";
               case "pending":
                   return "Pilet ei ole makstud";
               default:
                   return "Piletit ei saa kasutada";
           }
       }
   }
   ```
   - `findById(ticket.id)` uuesti: `findByCode` tulemus võib olla juba vananenud (teine turvamees jõudis ette). Põhjus peab olema **praeguse** seisu järgi.
   - `used.usedAt!`: `markUsed` pani selle just, seega on see olemas.
   - Kellaaeg Eesti ajas, sest turvamees on Eestis (sama mõte mis frontendi `formatDateTime`).
5. `scan.controller.ts`: `scan` → `scanDto.parse(req.body)` → service → `toScanResponse`.
   `scan.routes.ts`:
   ```ts
   const scanService = new ScanService(ticketRepository, eventStaffService, eventService);
   const scanController = new ScanController(scanService);

   export const scanRouter = Router();

   scanRouter.use(requireAuth, requireRole("security"));

   scanRouter.post("/", scanController.scan);
   ```
   `src/app.ts`: `app.use("/api/scan", scanRouter);`
6. Testid `tests/scan/scan.routes.test.ts` (üritus, mis algab ~1 tunni pärast, ja turvamees lisatud):
   - kehtiv pilet → `200`, `ticketType`, andmebaasis `scannedBy` = turvamees
   - teine skännimine → `409` ja teates on kellaaeg
   - **kaks turvameest korraga** (`Promise.all`) → `[200, 409]`
   - turvamees pole sellele üritusele lisatud → `403`
   - tühistatud pilet → `409` "tühistatud"
   - skännimine pole veel avatud (üritus nädala pärast) → `409`
   - olematu kood → `404`, teise ürituse pilet → `409`
7. **Seeder.** `seed.ts`:
   - `createOrder` (#30) tagastagu loodud piletid: `const createdTickets = await db.insert(ticketSchema).values(...).returning();` ja funktsiooni lõppu `return createdTickets;`
   - "Täna õhtul" ostust salvesta piletid ja märgi üks kasutatuks:
   ```ts
   const tonightTickets = await createOrder(
       attendeeA.id,
       tonight.id,
       [{ticketType: typeOf("Elektroonilise muusika öö", "Tavapilet"), quantity: 2}],
       "paid",
   );

   const [usedTicket] = tonightTickets;
   if (usedTicket) {
       await db
           .update(ticketSchema)
           .set({status: "used", usedAt: new Date(), scannedBy: security.id})
           .where(eq(ticketSchema.id, usedTicket.id));
   }
   ```
   Teine pilet jääb kehtivaks: seda saab ise skännida.
8. **Proovi:** `npm run seed -- sinu@gmail.com` (admin pääseb skännima, #11). Võta `fetch("/api/orders/me")`-st "Elektroonilise muusika öö" pileti `code` ja:
   ```js
   await fetch("/api/scan", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({eventId: "<tonight id>", code: "<code>"})}).then((r) => r.json());
   ```
   Teine kord → "juba kasutatud". Studios proovi seeditud `used` piletit: teates on seederi käivitamise kellaaeg.

## Valmis, kui…

- [ ] Kehtiv pilet läheb läbi ja salvestub, kes ja millal skännis
- [ ] Samaaegne topeltskännimine laseb läbi ainult ühe
- [ ] Mittekehtiva pileti korral on vastuses põhjus
- [ ] Teise ürituse turvamees saab `403`, väljaspool aega `409`
- [ ] Seederis on üks kasutatud ja üks kehtiv pilet tänasel üritusel

## Mida sa saavutasid

- **Nüüd töötab:** Uksel skännimine töötab: kehtiv pilet läheb läbi ja mittekehtiva korral näeb turvamees põhjust.
- **Said selgeks:** Sama võidujooks nagu sammus 29, aga teises kohas: topeltskännimine peab laskma läbi ainult ühe.
- **Edasi:** Kogu ostja teekond on valmis: ostmine → makse → QR → uks. Viimane verstapost teeb rakenduse kvaliteetseks.

## Kontrollküsimused

1. **Miks `markUsed` on üks `UPDATE ... WHERE status = 'active'`?** Kaks samaaegset skännimist: ainult üks saab rea.
2. **Miks põhjuse jaoks loetakse pilet uuesti?** Esimene lugemine võib olla vananenud.
3. **Miks ei piisa rollist `security`?** Turvamees tohib skännida ainult üritustel, kuhu ta on lisatud.

## Materjalid

- [Drizzle: Update with returning](https://orm.drizzle.team/docs/update#update-with-returning)
- [MDN: toLocaleTimeString](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toLocaleTimeString)

## Sõltub

- #38
- #39
