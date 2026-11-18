---
title: 22. Ürituste testid: DTO, service ja route'id
milestone: M4 – Testid
labels: test, suurus: L
---

## Eesmärk

Ürituste moodul on testidega kaetud kolmel tasemel: DTO reeglid, service'i äriloogika (ilma andmebaasita) ja route'id läbi kogu ahela testandmebaasi vastu.

## Taust

| Test | Mida kontrollib | Andmebaas | Kiirus |
|---|---|---|---|
| **DTO** (`create-event.dto.test.ts`) | zod reeglid | ei | väga kiire |
| **Unit** (`event.service.test.ts`) | service'i reeglid, repository asemel võltsobjekt | ei | kiire |
| **Integratsioon** (`event.routes.test.ts`) | päris päring → `requireAuth` → controller → service → repository → baas | jah | aeglasem |

- **Põhiliselt integratsioonitestid:** need annavad kõige rohkem kindlust ("kas API töötab?") ja ei purune, kui sisemust ümber korraldad.
- **Service'i unit test on üks fail õppimiseks:** et `vi.fn()` (võltsfunktsioon) oleks tuttav. Võlts-repository antakse konstruktoris: nüüd tasub ära, et sõltuvused tulevad konstruktorist (#15).
- **Testiandmed tulevad abifunktsioonidest:** `eventBody()` annab korrektse keha, test muudab ainult seda, mida ta kontrollib (`eventBody({endsAt: "..."})`).
- **Testi nimi ütleb, mida oodatakse:** `it("tagastab 403, kui üritus kuulub teisele korraldajale")`. Kukkunud testi nimest saab kohe aru, mis katki läks.

## Sammud

1. `tests/helpers/factories.ts`:
   ```ts
   import type {AuthUser} from "../../src/auth/express.js";
   import type {Event} from "../../src/db/schema/event.schema.js";
   import type {Role} from "./auth.js";

   export function eventBody(overrides: Record<string, unknown> = {}) {
       return {
           title: "Kontsert",
           description: "Pikk kirjeldus",
           shortDescription: "Lühike kirjeldus",
           imageUrl: "https://example.com/pilt.png",
           locationName: "Saku Suurhall",
           address: "Paldiski mnt 104b",
           city: "Tallinn",
           startsAt: "2026-12-01T19:00:00+02:00",
           endsAt: "2026-12-01T22:00:00+02:00",
           salesStartAt: "2026-11-01T10:00:00+02:00",
           salesEndAt: "2026-12-01T18:00:00+02:00",
           ...overrides,
       };
   }

   export function buildEvent(overrides: Partial<Event> = {}): Event {
       return {
           id: crypto.randomUUID(),
           title: "Kontsert",
           description: "Pikk kirjeldus",
           shortDescription: "Lühike kirjeldus",
           imageUrl: null,
           locationName: "Saku Suurhall",
           address: "Paldiski mnt 104b",
           city: "Tallinn",
           startsAt: new Date("2026-12-01T17:00:00Z"),
           endsAt: new Date("2026-12-01T20:00:00Z"),
           salesStartAt: new Date("2026-11-01T08:00:00Z"),
           salesEndAt: new Date("2026-12-01T16:00:00Z"),
           status: "draft",
           organizerId: crypto.randomUUID(),
           createdAt: new Date(),
           updatedAt: new Date(),
           ...overrides,
       };
   }

   export function buildUser(role: Role, overrides: Partial<AuthUser> = {}): AuthUser {
       return {
           id: crypto.randomUUID(),
           name: "Test Kasutaja",
           email: "test@test.ee",
           emailVerified: true,
           image: null,
           role,
           createdAt: new Date(),
           updatedAt: new Date(),
           ...overrides,
       };
   }
   ```
   - `eventBody`: päringu keha (kuupäevad stringidena, nagu klient saadab).
   - `buildEvent`, `buildUser`: valmis objektid unit testile, kus andmebaasi pole.
2. `tests/helpers/api.ts`:
   ```ts
   import request from "supertest";
   import app from "../../src/app.js";
   import {loginAs} from "./auth.js";
   import {eventBody} from "./factories.js";

   export async function createEventAsOrganizer(overrides: Record<string, unknown> = {}) {
       const organizer = await loginAs("organizer");
       const response = await request(app).post("/api/events").set("Cookie", organizer.cookie).send(eventBody(overrides));
       return {organizer, event: response.body};
   }

   export async function createPublishedEvent(overrides: Record<string, unknown> = {}) {
       const {organizer, event} = await createEventAsOrganizer(overrides);
       const response = await request(app).post(`/api/events/${event.id}/publish`).set("Cookie", organizer.cookie);
       return {organizer, event: response.body};
   }
   ```
   Andmed luuakse **läbi päris API**, nagu klient teeks: testid ei sõltu sellest, kuidas tabelid sees välja näevad.
3. `tests/event/dto/create-event.dto.test.ts`:
   ```ts
   import {describe, expect, it} from "vitest";
   import {createEventDto} from "../../../src/event/dto/create-event.dto.js";
   import {eventBody} from "../../helpers/factories.js";

   function errorFields(body: Record<string, unknown>) {
       const result = createEventDto.safeParse(body);
       return result.error?.issues.map((issue) => issue.path.join("."));
   }

   describe("createEventDto", () => {
       it("lubab korrektse keha ja teisendab kuupäevad Date-objektideks", () => {
           expect(createEventDto.parse(eventBody()).startsAt).toBeInstanceOf(Date);
       });

       it("ei luba ajavööndita kuupäeva", () => {
           expect(errorFields(eventBody({startsAt: "2026-12-01T19:00:00"}))).toContain("startsAt");
       });

       it("annab endsAt välja vea, kui üritus lõpeb enne algust", () => {
           expect(errorFields(eventBody({endsAt: "2026-12-01T18:00:00+02:00"}))).toContain("endsAt");
       });
   });
   ```
   Lisa ise: `imageUrl` võib puududa, müük lõpeb pärast üritust, müük lõpeb enne müügi algust.
4. `tests/event/event.service.test.ts`:
   ```ts
   import {beforeEach, describe, expect, it, vi} from "vitest";
   import {createEventDto} from "../../src/event/dto/create-event.dto.js";
   import type {EventRepository} from "../../src/event/event.repository.js";
   import {EventService} from "../../src/event/event.service.js";
   import {ConflictError, ForbiddenError, NotFoundError} from "../../src/shared/errors/http.errors.js";
   import {buildEvent, buildUser, eventBody} from "../helpers/factories.js";

   function createService() {
       const repository = {
           findAll: vi.fn(),
           findAllByOrganizerId: vi.fn(),
           findAllPublished: vi.fn(),
           findById: vi.fn(),
           create: vi.fn(),
           update: vi.fn(),
           delete: vi.fn(),
       };
       const service = new EventService(repository as unknown as EventRepository);
       return {service, repository};
   }

   describe("EventService", () => {
       let service: EventService;
       let repository: ReturnType<typeof createService>["repository"];

       beforeEach(() => {
           ({service, repository} = createService());
           repository.update.mockResolvedValue(buildEvent());
       });

       it("findById viskab NotFoundError'i, kui üritust pole", async () => {
           repository.findById.mockResolvedValue(undefined);

           await expect(service.findById(crypto.randomUUID())).rejects.toThrow(NotFoundError);
       });

       it("findAll tagastab korraldajale ainult tema enda üritused", async () => {
           const organizer = buildUser("organizer");

           await service.findAll(organizer);

           expect(repository.findAllByOrganizerId).toHaveBeenCalledWith(organizer.id);
           expect(repository.findAll).not.toHaveBeenCalled();
       });

       it("update viskab ForbiddenError'i, kui üritus kuulub teisele korraldajale", async () => {
           repository.findById.mockResolvedValue(buildEvent());

           const dto = createEventDto.parse(eventBody());

           await expect(service.update(crypto.randomUUID(), dto, buildUser("organizer"))).rejects.toThrow(ForbiddenError);
           expect(repository.update).not.toHaveBeenCalled();
       });

       it("publish viskab ConflictError'i, kui üritus on juba avaldatud", async () => {
           const owner = buildUser("organizer");
           repository.findById.mockResolvedValue(buildEvent({organizerId: owner.id, status: "published"}));

           await expect(service.publish(crypto.randomUUID(), owner)).rejects.toThrow(ConflictError);
       });
   });
   ```
   - `vi.fn()` = võltsfunktsioon. `.mockResolvedValue(x)`: "kui sind kutsutakse, tagasta `x`". `toHaveBeenCalledWith(...)`: kas kutsuti õigete argumentidega.
   - `as unknown as EventRepository`: päris klassil on `private db` väli, võltsobjektil mitte. Ütleme ühes kohas "usalda mind".

   Lisa ise: admin näeb kõiki, `create` võtab `organizerId` parameetrist, `update` paneb saatmata `imageUrl` asemele `null`, `delete` avaldatud üritusele → `ConflictError`, `findPublishedById` mustandile → `NotFoundError`.
5. `tests/event/event.routes.test.ts` (näidis, ülejäänud kirjuta samas stiilis):
   ```ts
   import request from "supertest";
   import {describe, expect, it} from "vitest";
   import app from "../../src/app.js";
   import {createEventAsOrganizer, createPublishedEvent} from "../helpers/api.js";
   import {loginAs} from "../helpers/auth.js";
   import {eventBody} from "../helpers/factories.js";

   describe("/api/events (haldus)", () => {
       it("tagastab 401, kui kasutaja pole sisse loginud", async () => {
           const response = await request(app).get("/api/events");

           expect(response.status).toBe(401);
       });

       it("loob korraldaja nimele uue ürituse mustandina", async () => {
           const {cookie, user} = await loginAs("organizer");

           const response = await request(app).post("/api/events").set("Cookie", cookie).send(eventBody());

           expect(response.status).toBe(201);
           expect(response.body).toMatchObject({status: "draft", organizerId: user.id});
       });

       it("tagastab 403, kui üritus kuulub teisele korraldajale", async () => {
           const {event} = await createEventAsOrganizer();
           const other = await loginAs("organizer");

           const response = await request(app).get(`/api/events/${event.id}`).set("Cookie", other.cookie);

           expect(response.status).toBe(403);
       });

       it("tagastab avaldatud ürituse kustutamisel 409", async () => {
           const {organizer, event} = await createPublishedEvent();

           const response = await request(app).delete(`/api/events/${event.id}`).set("Cookie", organizer.cookie);

           expect(response.status).toBe(409);
       });
   });
   ```
   Kata vähemalt: `403` attendee'le, korraldaja näeb ainult enda üritusi, admin näeb kõiki, vigane uuid → `400`, olematu → `404`, vigased kuupäevad → `400` + `details.endsAt`, `PUT` omanikuna, mustandi `DELETE` → `204` ja siis `404`, publish → avalikus nimekirjas, cancel, tühistatut ei saa uuesti avaldada.
6. `tests/event/public-event.routes.test.ts`: **ükski test ei logi sisse**. Kata: ainult avaldatud nimekirjas, vastuses pole `organizerId` ega `status`, tühistatud üritus → `404`, mustand → `404`.
7. `npm test`. Proovi meelega katki teha: kommenteeri `findOwnedById`-s omaniku kontroll välja. Mitu testi kukub ja kas nimest saab aru, mis katki on?

## Valmis, kui…

- [ ] DTO, service'i, halduse ja avaliku osa testid on olemas ja rohelised
- [ ] Iga `event.service.ts` reegel (omanik, olek, admin) on vähemalt ühe testiga kaetud
- [ ] Omaniku kontrolli väljakommenteerimine teeb teste punaseks

## Mida sa saavutasid

- **Nüüd töötab:** Ürituste moodul on kaetud testidega kolmel tasemel: DTO, service ja päris HTTP päringud.
- **Said selgeks:** Integratsioonitestid annavad kõige rohkem kindlust. `vi.fn()` asendab sõltuvust. Hea testi nimi ütleb, mis katki läks.
- **Edasi:** Alates nüüd lisab iga uute route'idega samm ka testid. See on osa sammust, mitte lisaülesanne.

## Edaspidi

**Iga järgmine issue, mis lisab route'e, lisab ka testid** (vähemalt: õnnestumine, `401`/`403`, valideerimine, peamised `409`/`404` reeglid).

## Kontrollküsimused

1. **Miks enamik teste on integratsioonitestid?** Need kontrollivad, kas API päriselt töötab, ja ei purune sisemise ümberkorraldamise peale.
2. **Miks andmed luuakse läbi API, mitte otse andmebaasi?** Testid ei sõltu tabelite sisemusest.
3. **Mida teeb `vi.fn()`?** Võltsfunktsioon: saab määrata tagastusväärtuse ja kontrollida, kuidas seda kutsuti.

## Materjalid

- [Vitest: Mocking](https://vitest.dev/guide/mocking)
- [Kent C. Dodds: Write tests. Not too many. Mostly integration.](https://kentcdodds.com/blog/write-tests)

## Sõltub

- #21
