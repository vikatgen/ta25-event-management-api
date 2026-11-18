---
title: 25. Piletitüüpide haldus: /api/events/:eventId/ticket-types
milestone: M5 – Piletitüübid
labels: api, suurus: L
---

## Eesmärk

Ürituse omanik (või admin) saab hallata ürituse piletitüüpe:

| Meetod | Aadress | Vastus |
|---|---|---|
| `GET` | `/api/events/:eventId/ticket-types` | `200` ürituse piletitüübid |
| `POST` | `/api/events/:eventId/ticket-types` | `201` loodud |
| `PUT` | `/api/events/:eventId/ticket-types/:id` | `200` muudetud, `409` kogus alla müüdu |
| `DELETE` | `/api/events/:eventId/ticket-types/:id` | `204` kustutatud, `409` on müüke |

## Taust

- **Pesastatud aadress** `/events/:eventId/ticket-types`: piletitüüp on alati ühe ürituse oma. Aadressist on näha, kelle oma.
- **Moodul küsib teiselt moodulilt:** "kas üritus on olemas" ja "kas see on sinu oma" on **ürituse reeglid**. Me ei kirjuta neid siia uuesti, vaid `TicketTypeService` saab konstruktoris `EventService`-i ja küsib temalt (`findOwnedById`). Seepärast ekspordib `event.routes.ts` nüüd `eventService`-i: kõik kasutavad sama objekti.
- **Teise ürituse piletitüüp:** repository otsib `id` **ja** `eventId` järgi. Nii ei saa `/events/A/ticket-types/<B ürituse tüüp>` kaudu võõrast tüüpi muuta: ei leia midagi → `404`.
- **Reeglid:**
  - tühistatud ürituse piletitüüpe ei muudeta → `409`
  - kogust ei saa vähendada alla müüdud piletite arvu (need on juba kellelgi) → `409`
  - piletitüüpi, millel on müüke, ei saa kustutada → `409`
- **`mergeParams: true`:** `:eventId` on `app.ts`-i aadressis, mitte routeris. Vaikimisi näeb router ainult enda parameetreid.
- **Pikemad aadressid enne lühemaid `app.ts`-is:** `eventRouter.use(requireAuth, requireRole(...))` jookseb iga `/api/events/...` päringu peal. Kui `/api/events/:eventId/ticket-types` oleks tema järel, läbiks päring kõigepealt ürituste routeri.
- 🟢 Frontendi "Piletitüüpide haldus" kasutab neid aadresse.

## Sammud

1. `src/ticket-type/dto/create-ticket-type.dto.ts`:
   ```ts
   import z from "zod";

   export const createTicketTypeDto = z.object({
       name: z.string().min(1).max(100),
       priceCents: z.int().min(0),
       capacity: z.int().positive(),
   });

   export type CreateTicketTypeDto = z.infer<typeof createTicketTypeDto>;
   ```
   `z.int()`: ainult täisarv. Pole `eventId` (tuleb URL-ist) ega `sold` (muutub ainult ostul).
2. `src/ticket-type/dto/ticket-type-response.dto.ts`: `TicketTypeResponseDto` tüüp ja `toTicketTypeResponse(ticketType)` (väljad `id`, `eventId`, `name`, `priceCents`, `capacity`, `sold`, `createdAt`, `updatedAt`), nagu #14-s.
3. `src/ticket-type/ticket-type.repository.ts`:
   ```ts
   import {and, eq} from "drizzle-orm";
   import type {Database} from "../db/index.js";
   import {type CreateTicketType, type TicketType, ticketTypeSchema} from "../db/schema/ticket-type.schema.js";
   import {UnexpectedError} from "../shared/errors/unexpected.error.js";

   export class TicketTypeRepository {
       constructor(private readonly db: Database) {}

       async findAllByEventId(eventId: string): Promise<TicketType[]> {
           return this.db.select().from(ticketTypeSchema).where(eq(ticketTypeSchema.eventId, eventId));
       }

       async findById(eventId: string, id: string): Promise<TicketType | undefined> {
           const [ticketType] = await this.db
               .select()
               .from(ticketTypeSchema)
               .where(and(eq(ticketTypeSchema.id, id), eq(ticketTypeSchema.eventId, eventId)));
           return ticketType;
       }

       async create(ticketType: CreateTicketType): Promise<TicketType> {
           const [created] = await this.db.insert(ticketTypeSchema).values(ticketType).returning();

           if (!created) {
               throw new UnexpectedError("INSERT ei tagastanud piletitüüpi");
           }

           return created;
       }

       async update(id: string, ticketType: Partial<CreateTicketType>): Promise<TicketType | undefined> {
           const [updated] = await this.db
               .update(ticketTypeSchema)
               .set(ticketType)
               .where(eq(ticketTypeSchema.id, id))
               .returning();
           return updated;
       }

       async delete(id: string): Promise<void> {
           await this.db.delete(ticketTypeSchema).where(eq(ticketTypeSchema.id, id));
       }
   }
   ```
4. `src/ticket-type/ticket-type.service.ts`:
   ```ts
   import type {AuthUser} from "../auth/express.js";
   import type {Event} from "../db/schema/event.schema.js";
   import type {TicketType} from "../db/schema/ticket-type.schema.js";
   import type {EventService} from "../event/event.service.js";
   import {ConflictError, NotFoundError} from "../shared/errors/http.errors.js";
   import type {CreateTicketTypeDto} from "./dto/create-ticket-type.dto.js";
   import type {TicketTypeRepository} from "./ticket-type.repository.js";

   export class TicketTypeService {
       constructor(
           private readonly repository: TicketTypeRepository,
           private readonly eventService: EventService,
       ) {}

       async findAll(eventId: string, user: AuthUser): Promise<TicketType[]> {
           await this.eventService.findOwnedById(eventId, user);
           return this.repository.findAllByEventId(eventId);
       }

       async create(eventId: string, ticketType: CreateTicketTypeDto, user: AuthUser): Promise<TicketType> {
           await this.findEditableEvent(eventId, user);
           return this.repository.create({...ticketType, eventId});
       }

       async update(eventId: string, id: string, ticketType: CreateTicketTypeDto, user: AuthUser): Promise<TicketType> {
           await this.findEditableEvent(eventId, user);
           const existing = await this.findById(eventId, id);

           if (ticketType.capacity < existing.sold) {
               throw new ConflictError(`Kogus ei saa olla väiksem kui müüdud piletite arv (${existing.sold})`);
           }

           const updated = await this.repository.update(id, ticketType);

           if (!updated) {
               throw new NotFoundError("Piletitüüpi ei leitud");
           }

           return updated;
       }

       async delete(eventId: string, id: string, user: AuthUser): Promise<void> {
           await this.findEditableEvent(eventId, user);
           const existing = await this.findById(eventId, id);

           if (existing.sold > 0) {
               throw new ConflictError("Piletitüüpi, millel on müüdud pileteid, ei saa kustutada");
           }

           await this.repository.delete(id);
       }

       private async findById(eventId: string, id: string): Promise<TicketType> {
           const ticketType = await this.repository.findById(eventId, id);

           if (!ticketType) {
               throw new NotFoundError("Piletitüüpi ei leitud");
           }

           return ticketType;
       }

       private async findEditableEvent(eventId: string, user: AuthUser): Promise<Event> {
           const event = await this.eventService.findOwnedById(eventId, user);

           if (event.status === "cancelled") {
               throw new ConflictError("Tühistatud ürituse piletitüüpe ei saa muuta");
           }

           return event;
       }
   }
   ```
   Kustutamise reegel `sold > 0` muutub täpsemaks, kui pileteid saab tühistada (#34).
5. `src/ticket-type/ticket-type.controller.ts`:
   ```ts
   export const eventParams = z.object({eventId: z.uuid()});
   export const ticketTypeParams = z.object({eventId: z.uuid(), id: z.uuid()});
   ```
   ja meetodid `findAll`, `create` (`201`), `update`, `delete` (`204`) nagu `EventController`-is (#16, #17): parse params → parse body → service → DTO.
6. `src/event/event.routes.ts`: `export const eventService = ...` (lisa `export`).
7. `src/ticket-type/ticket-type.routes.ts`:
   ```ts
   import {Router} from "express";
   import {requireAuth, requireRole} from "../auth/require-auth.middleware.js";
   import {db} from "../db/index.js";
   import {eventService} from "../event/event.routes.js";
   import {TicketTypeController} from "./ticket-type.controller.js";
   import {TicketTypeRepository} from "./ticket-type.repository.js";
   import {TicketTypeService} from "./ticket-type.service.js";

   const ticketTypeRepository = new TicketTypeRepository(db);
   const ticketTypeService = new TicketTypeService(ticketTypeRepository, eventService);
   const ticketTypeController = new TicketTypeController(ticketTypeService);

   export const ticketTypeRouter = Router({mergeParams: true});

   ticketTypeRouter.use(requireAuth, requireRole("organizer"));

   ticketTypeRouter.get("/", ticketTypeController.findAll);
   ticketTypeRouter.post("/", ticketTypeController.create);
   ticketTypeRouter.put("/:id", ticketTypeController.update);
   ticketTypeRouter.delete("/:id", ticketTypeController.delete);
   ```
8. `src/app.ts`, **enne** `/api/events` rida:
   ```ts
   app.use("/api/events/:eventId/ticket-types", ticketTypeRouter);
   ```
9. Testid:
   - `tests/helpers/factories.ts`: `ticketTypeBody(overrides)` → `{name: "Tavapilet", priceCents: 2500, capacity: 100, ...overrides}`
   - `tests/helpers/api.ts`: `createTicketType(eventId, cookie, overrides)` (POST ja tagastab `response.body`)
   - `tests/ticket-type/dto/create-ticket-type.dto.test.ts`: komakohaga hind, negatiivne hind, kogus 0
   - `tests/ticket-type/ticket-type.routes.test.ts`: omanik loob (`201`, `sold: 0`), teine korraldaja `403`, attendee `403`, olematu üritus `404`, teise ürituse piletitüübi `PUT` → `404`, tühistatud üritusele lisamine `409`, mustandi kustutamisel lähevad tüübid kaasa
   - `capacity < sold` ja "müükidega tüüpi ei saa kustutada" testid tulevad #28-s, kui saab osta. Märgi need `it.todo("...")`-ga.

## Valmis, kui…

- [ ] Kõik 4 route'i töötavad ja omaniku kontroll tuleb `EventService`-ilt
- [ ] Teise ürituse piletitüüpi ei saa võõra `eventId` kaudu muuta (`404`)
- [ ] Tühistatud ürituse piletitüüpe ei saa muuta (`409`)
- [ ] Testid on rohelised, ootel testid on `it.todo`

## Mida sa saavutasid

- **Nüüd töötab:** Korraldaja saab oma ürituse piletitüüpe lisada, muuta ja kustutada.
- **Said selgeks:** Pesastatud ressurss (`/events/:eventId/ticket-types`): omaniku kontroll tuleb ürituselt ja võõra ürituse id kaudu ei saa teise piletitüüpi muuta.
- **Edasi:** Järgmine samm näitab piletitüüpe ostjale.

## Kontrollküsimused

1. **Miks `TicketTypeService` saab `EventService`-i, mitte ei loe `events` tabelit ise?** Ürituse reeglid on ühes kohas ja neid ei kirjutata uuesti.
2. **Miks repository otsib `id` ja `eventId` järgi?** Muidu saaks võõra ürituse piletitüüpi muuta.
3. **Miks `app.ts`-is peab pikem aadress olema enne lühemat?** Muidu läbiks päring ka ürituste routeri `use(...)` kaitse.

## Materjalid

- [Express: Router mergeParams](https://expressjs.com/en/api.html#express.router)
- [Vitest: it.todo](https://vitest.dev/api/#test-todo)

## Sõltub

- #22
- #24
