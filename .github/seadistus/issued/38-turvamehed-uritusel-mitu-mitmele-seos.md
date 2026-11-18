---
title: 38. Turvamehed üritusel (mitu-mitmele seos)
milestone: M9 – Uks ja admin
labels: andmebaas, suurus: L
---

## Eesmärk

Korraldaja saab oma üritusele lisada turvamehi (kasutajad rolliga `security`), kes hiljem uksel pileteid skännivad (#40). Uus tabel `event_staff` (seitsmes migratsioon). Seeder lisab turvamehe kahele üritusele.

| Meetod | Aadress | Vastus |
|---|---|---|
| `GET` | `/api/events/:eventId/staff` | `200` ürituse turvamehed |
| `POST` | `/api/events/:eventId/staff` | `201` uus nimekiri, `404` kasutajat pole, `409` pole turvamees või juba lisatud |
| `DELETE` | `/api/events/:eventId/staff/:userId` | `204` eemaldatud |

## Taust

- **Mitu-mitmele seos:** üks turvamees võib töötada mitmel üritusel, ühel üritusel on mitu turvameest. Selleks on **vahetabel** `event_staff`, kus on ainult kaks viidet.
  ```
  events ──< event_staff >── user
  ```
- **Liitvõti:** `primaryKey({columns: [eventId, userId]})`. Sama inimest ei saa samale üritusele kaks korda lisada. Eraldi `id` veergu pole vaja: paar ise on unikaalne.
- **`onDelete: "cascade"` mõlemal pool:** kui üritus või kasutaja kustub, kaob ka seos. Seos ise pole ajalugu (erinevalt piletist).
- **Lisamine e-posti järgi:** korraldaja ei tea kasutaja id-d, aga teab e-posti. Kasutaja peab olema vähemalt korra sisse loginud ja tal peab olema roll `security` (selle annab admin, #37).
- **`onConflictDoNothing()`:** kui rida on juba olemas, ei visata andmebaasi viga. Tühi tulemus = juba lisatud → `409` selge teatega.
- **`isStaff(eventId, user)`:** kas see kasutaja tohib selle ürituse pileteid skännida? Admin alati. Skännimine (#40) küsib seda siit.
- 🟢 Frontendi "Turvamehed üritusel" kasutab neid aadresse.

## Sammud

1. `src/db/schema/event-staff.schema.ts`:
   ```ts
   import {pgTable, primaryKey, timestamp, uuid} from "drizzle-orm/pg-core";
   import {user} from "./auth.js";
   import {eventSchema} from "./event.schema.js";

   export const eventStaffSchema = pgTable(
       "event_staff",
       {
           eventId: uuid()
               .references(() => eventSchema.id, {onDelete: "cascade"})
               .notNull(),
           userId: uuid()
               .references(() => user.id, {onDelete: "cascade"})
               .notNull(),
           createdAt: timestamp({withTimezone: true}).defaultNow().notNull(),
       },
       (table) => [primaryKey({columns: [table.eventId, table.userId]})],
   );
   ```
   ```bash
   npm run db:generate -- --name=create_event_staff_table
   npm run db:migrate
   ```
   Loe SQL: `PRIMARY KEY("event_id","user_id")`.
2. `src/event-staff/event-staff.repository.ts`:
   ```ts
   export type StaffMember = {
       userId: string;
       name: string;
       email: string;
       addedAt: Date;
   };

   export class EventStaffRepository {
       constructor(private readonly db: Database) {}

       async findAllByEventId(eventId: string): Promise<StaffMember[]> {
           return this.db
               .select({userId: user.id, name: user.name, email: user.email, addedAt: eventStaffSchema.createdAt})
               .from(eventStaffSchema)
               .innerJoin(user, eq(eventStaffSchema.userId, user.id))
               .where(eq(eventStaffSchema.eventId, eventId));
       }

       async exists(eventId: string, userId: string): Promise<boolean> {
           const [row] = await this.db
               .select({userId: eventStaffSchema.userId})
               .from(eventStaffSchema)
               .where(and(eq(eventStaffSchema.eventId, eventId), eq(eventStaffSchema.userId, userId)));
           return row !== undefined;
       }

       async add(eventId: string, userId: string): Promise<boolean> {
           const rows = await this.db.insert(eventStaffSchema).values({eventId, userId}).onConflictDoNothing().returning();
           return rows.length > 0;
       }

       async remove(eventId: string, userId: string): Promise<boolean> {
           const rows = await this.db
               .delete(eventStaffSchema)
               .where(and(eq(eventStaffSchema.eventId, eventId), eq(eventStaffSchema.userId, userId)))
               .returning();
           return rows.length > 0;
       }
   }
   ```
   `select({...})` valib ainult vajalikud väljad mõlemast tabelist: kasutaja sessioonid ja muu ei tule kaasa.
3. `src/event-staff/event-staff.service.ts`:
   ```ts
   export class EventStaffService {
       constructor(
           private readonly repository: EventStaffRepository,
           private readonly eventService: EventService,
           private readonly userRepository: UserRepository,
       ) {}

       async findAll(eventId: string, user: AuthUser): Promise<StaffMember[]> {
           await this.eventService.findOwnedById(eventId, user);
           return this.repository.findAllByEventId(eventId);
       }

       async add(eventId: string, email: string, user: AuthUser): Promise<StaffMember[]> {
           await this.eventService.findOwnedById(eventId, user);
           const member = await this.userRepository.findByEmail(email);

           if (!member) {
               throw new NotFoundError("Kasutajat ei leitud");
           }

           if (member.role !== "security") {
               throw new ConflictError("Kasutaja ei ole turvamees (roll security)");
           }

           if (!(await this.repository.add(eventId, member.id))) {
               throw new ConflictError("Turvamees on juba sellel üritusel");
           }

           return this.repository.findAllByEventId(eventId);
       }

       async remove(eventId: string, userId: string, user: AuthUser): Promise<void> {
           await this.eventService.findOwnedById(eventId, user);

           if (!(await this.repository.remove(eventId, userId))) {
               throw new NotFoundError("Seda turvameest sellel üritusel pole");
           }
       }

       async isStaff(eventId: string, user: AuthUser): Promise<boolean> {
           return user.role === "admin" || this.repository.exists(eventId, user.id);
       }
   }
   ```
   `add` tagastab kogu uue nimekirja: frontend saab selle kohe näidata.
4. DTO-d: `add-staff.dto.ts` (`z.object({email: z.email()})`), `staff-response.dto.ts` (`toStaffResponse(member)`: `userId`, `name`, `email`, `addedAt` ISO stringina).
5. `event-staff.controller.ts`: `eventParams = z.object({eventId: z.uuid()})`, `staffParams = z.object({eventId: z.uuid(), userId: z.uuid()})`, meetodid `findAll`, `add` (`201`), `remove` (`204`).
6. `event-staff.routes.ts`:
   ```ts
   const eventStaffRepository = new EventStaffRepository(db);
   export const eventStaffService = new EventStaffService(eventStaffRepository, eventService, userRepository);
   const eventStaffController = new EventStaffController(eventStaffService);

   export const eventStaffRouter = Router({mergeParams: true});

   eventStaffRouter.use(requireAuth, requireRole("organizer"));

   eventStaffRouter.get("/", eventStaffController.findAll);
   eventStaffRouter.post("/", eventStaffController.add);
   eventStaffRouter.delete("/:userId", eventStaffController.remove);
   ```
   `src/app.ts`, **enne** `/api/events` rida: `app.use("/api/events/:eventId/staff", eventStaffRouter);`
7. Testid `tests/event-staff/event-staff.routes.test.ts`: omanik lisab e-posti järgi → `201` ja nimekirjas on turvamees; kasutajal pole `security` rolli → `409`; teist korda sama → `409`; olematu e-post → `404`; teise korraldaja üritus → `403`; eemaldamine → `204`, siis nimekiri tühi.
8. **Seeder.** `seed.ts`:
   - #20-s salvesta turvamees muutujasse: `const security = await createUser("Siim Turvamees", "security@seed.test", "security");`
   - impordi `eventStaffSchema` ja lisa tellimuste järele:
   ```ts
   await db.insert(eventStaffSchema).values([
       {eventId: tonight.id, userId: security.id},
       {eventId: rock.id, userId: security.id},
   ]);
   ```
   `TRUNCATE events CASCADE` tühjendab ka `event_staff`-i, seega korduv käivitus töötab.
9. Kontrolli: `npm run seed -- sinu@gmail.com`, siis konsoolist `fetch("/api/events/<tonight id>/staff")` → Siim Turvamees.

## Valmis, kui…

- [ ] Omanik saab turvamehi lisada, vaadata ja eemaldada
- [ ] Sama turvameest ei saa kaks korda lisada ja ilma `security` rollita kasutajat ei saa lisada
- [ ] Seeder lisab turvamehe "Elektroonilise muusika öö" ja Rokiõhtu üritusele
- [ ] Testid on rohelised

## Mida sa saavutasid

- **Nüüd töötab:** Korraldaja saab oma üritusele turvamehi lisada ja neid eemaldada.
- **Said selgeks:** **Mitu-mitmele seos**: liitvõtmega vahetabel, sest üks turvamees võib olla mitmel üritusel ja üritusel võib olla mitu turvameest.
- **Edasi:** Turvamees on paigas. Ostjal on vaja veel midagi, mida näidata: QR-koodi.

## Kontrollküsimused

1. **Miks on vaja vahetabelit?** Mitu-mitmele seost ei saa hoida ühe tabeli veerus.
2. **Miks liitvõti, mitte eraldi `id`?** Paar (üritus, kasutaja) ise on unikaalne ja keelab topelt lisamise.
3. **Miks lisamine käib e-posti, mitte id järgi?** Korraldaja teab e-posti, mitte andmebaasi id-d.

## Materjalid

- 📖 [M6 › Andmebaas ja seosed](https://vikatgen.github.io/oppematerjalid/veebirakendused/backend/05-andmebaas-ja-seosed): tabelid, primaar- ja võõrvõti, üks-mitmele ja mitu-mitmele, cascade vs restrict, check
- 📖 [M6 › Autentimine ja autoriseerimine](https://vikatgen.github.io/oppematerjalid/veebirakendused/backend/08-autentimine-ja-autoriseerimine): kes sa oled vs mida sa tohid, roll vs omanik, 401 vs 403 vs 404
- [Drizzle: Composite primary key](https://orm.drizzle.team/docs/indexes-constraints#composite-primary-key)
- [Drizzle: onConflictDoNothing](https://orm.drizzle.team/docs/insert#on-conflict-do-nothing)

## Sõltub

- #36
- #37
