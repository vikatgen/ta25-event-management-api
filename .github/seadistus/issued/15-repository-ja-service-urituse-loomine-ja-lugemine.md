---
title: 15. Repository ja service: ürituse loomine ja lugemine
milestone: M3 – Üritused
labels: api, suurus: M
---

## Eesmärk

Ürituste andmekiht (**repository**) ja äriloogika (**service**) on olemas: üritust saab luua, nimekirja ja ühe ürituse saab lugeda ning service teab, kelle oma üritus on.

## Taust

Kood on kihtides. Iga kiht teeb ühte asja:

```
HTTP → routes → controller → service → repository → andmebaas
                 (#16)        (see)      (see)
```

| Kiht | Teab | Ei tea |
|---|---|---|
| **repository** | SQL / Drizzle | HTTP-d, äriloogikat |
| **service** | reegleid ("korraldaja näeb ainult enda üritusi") | HTTP-d, SQL-i |
| **controller** | HTTP-d (`req`, `res`, staatuskoodid) | SQL-i |

- **Repository ei viska HTTP vigu.** Kui üritust pole, tagastab ta `undefined`. Service otsustab, et see on `404`. Nii saab sama repository't kasutada ka seal, kus "pole" ei ole viga.
- **Sõltuvused antakse konstruktoris** (`new EventService(repository)`). Testis saab anda võlts-repository (#22). 🟢 Vues oleks sarnane `provide`/`inject`; siin teeme selle käsitsi.
- **Roll vs omanik:** `requireRole("organizer")` kontrollib, et oled korraldaja. Kas see üritus on **sinu oma**, teab ainult service, sest selleks on vaja üritust andmebaasist lugeda. Admin pääseb alati.
- **Järjekord on nimekirjas kohustuslik.** Ilma `orderBy`-ta võib Postgres anda read iga kord eri järjekorras. `id` teisena: kui algusaeg on sama, on järjekord ikka alati sama.

## Sammud

1. `src/db/index.ts`, lisa lõppu:
   ```ts
   export type Database = typeof db;
   ```
   Tüüp tuleb päris objektist, seda ei kirjuta käsitsi.
2. `src/event/event.repository.ts`:
   ```ts
   import {asc, eq} from "drizzle-orm";
   import type {Database} from "../db/index.js";
   import {type CreateEvent, type Event, eventSchema} from "../db/schema/event.schema.js";
   import {UnexpectedError} from "../shared/errors/unexpected.error.js";

   export class EventRepository {
       constructor(private readonly db: Database) {}

       async findAll(): Promise<Event[]> {
           return this.db.select().from(eventSchema).orderBy(asc(eventSchema.startsAt), asc(eventSchema.id));
       }

       async findAllByOrganizerId(organizerId: string): Promise<Event[]> {
           return this.db
               .select()
               .from(eventSchema)
               .where(eq(eventSchema.organizerId, organizerId))
               .orderBy(asc(eventSchema.startsAt), asc(eventSchema.id));
       }

       async findById(id: string): Promise<Event | undefined> {
           const [event] = await this.db.select().from(eventSchema).where(eq(eventSchema.id, id));
           return event;
       }

       async create(event: CreateEvent): Promise<Event> {
           const [createdEvent] = await this.db.insert(eventSchema).values(event).returning();

           if (!createdEvent) {
               throw new UnexpectedError("INSERT ei tagastanud üritust");
           }

           return createdEvent;
       }
   }
   ```
   - `private readonly db` konstruktoris: TypeScript loob välja ise (lühem kui eraldi väli + omistamine).
   - Drizzle tagastab alati massiivi. `const [event] = ...` võtab esimese rea; kui ridu pole, on see `undefined`.
   - `if (!createdEvent)`: `INSERT ... RETURNING` tagastab alati rea. Kontroll on ainult TypeScripti pärast, seega `UnexpectedError` (#12).
3. `src/event/event.service.ts`:
   ```ts
   import type {AuthUser} from "../auth/express.js";
   import type {Event} from "../db/schema/event.schema.js";
   import {ForbiddenError, NotFoundError} from "../shared/errors/http.errors.js";
   import type {CreateEventDto} from "./dto/create-event.dto.js";
   import type {EventRepository} from "./event.repository.js";

   export class EventService {
       constructor(private readonly repository: EventRepository) {}

       async findAll(user: AuthUser): Promise<Event[]> {
           if (user.role === "admin") {
               return this.repository.findAll();
           }

           return this.repository.findAllByOrganizerId(user.id);
       }

       async findById(id: string): Promise<Event> {
           const event = await this.repository.findById(id);

           if (!event) {
               throw new NotFoundError("Üritust ei leitud");
           }

           return event;
       }

       async findOwnedById(id: string, user: AuthUser): Promise<Event> {
           const event = await this.findById(id);

           if (user.role !== "admin" && event.organizerId !== user.id) {
               throw new ForbiddenError("See ei ole sinu üritus");
           }

           return event;
       }

       async create(event: CreateEventDto, organizerId: string): Promise<Event> {
           return this.repository.create({...event, organizerId});
       }
   }
   ```
   - `import type`: service vajab repository **tüüpi**, mitte klassi ennast. Objekti annab talle `event.routes.ts` (#16).
   - `findById` tagastab alati päris `Event`-i: controller ei pea ise `if`-i tegema.
   - `organizerId` tuleb parameetrina (sisselogitud kasutajalt), mitte DTO-st.
4. Service ei impordi `drizzle-orm`-i ega `express`-i. Kontrolli seda importide järgi.
5. `npm run typecheck`. Kasutada saab neid alles #16-s, kui tuleb controller.

## Valmis, kui…

- [ ] `EventRepository` ja `EventService` on olemas ja `typecheck` on puhas
- [ ] Repository ei viska `HttpError`-eid, service ei impordi Drizzle't
- [ ] `findOwnedById` laseb läbi omaniku ja admini, teistele `ForbiddenError`

## Mida sa saavutasid

- **Nüüd töötab:** Üritusi saab koodis luua ja lugeda ning service teab, kelle oma üritus on.
- **Said selgeks:** Kihid: **repository** räägib andmebaasiga, **service** hoiab reegleid. Sõltuvused tulevad konstruktorist, nii et neid saab testis asendada.
- **Edasi:** Järgmine samm ühendab selle HTTP-ga: controller ja route'id.

## Kontrollküsimused

1. **Miks repository tagastab `undefined`, mitte ei viska `NotFoundError`-it?** "Ei leidnud" ei ole alati viga. Otsustab service.
2. **Miks omanikku ei kontrolli `requireRole`?** Selleks on vaja üritust andmebaasist lugeda: see on äriloogika.
3. **Miks `orderBy(..., id)` teisena?** Sama algusajaga üritustel on järjekord ikka alati sama.

## Materjalid

- 📖 [M6 › Kihid: kes mida teeb?](https://vikatgen.github.io/oppematerjalid/veebirakendused/backend/02-kihiline-arhitektuur): route, middleware, controller, service, repository ja miks reeglid on service'is
- [Drizzle: Select](https://orm.drizzle.team/docs/select)
- [Drizzle: Insert](https://orm.drizzle.team/docs/insert)
- [TypeScript: Parameter properties](https://www.typescriptlang.org/docs/handbook/2/classes.html#parameter-properties)

## Sõltub

- #14
