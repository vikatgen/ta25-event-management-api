---
title: 16. Controller ja route'id: /api/events
milestone: M3 – Üritused
labels: api, suurus: L
---

## Eesmärk

Korraldaja saab API kaudu üritust luua ja oma üritusi vaadata:

| Meetod | Aadress | Vastus |
|---|---|---|
| `GET` | `/api/events` | `200` minu üritused (admin: kõik) |
| `GET` | `/api/events/:id` | `200` üritus, `403` pole sinu oma, `404` pole olemas |
| `POST` | `/api/events` | `201` loodud üritus, `400` vigased andmed |

## Taust

- **Controller** loeb päringu, valideerib, kutsub service'it ja teeb vastuse. Äriloogikat seal pole.
- **Routes fail** on koht, kus kõik kokku pannakse: `new` repository → service → controller. **`new` on ainult siin.** Teised klassid saavad oma sõltuvused konstruktoris.
- **`try/catch`-i pole:** `parse` viskab `ZodError`-i, service viskab `NotFoundError`-i. Express 5 saadab need ise `errorHandler`-ile (#12).
- **`this` lõks:** `router.get("/", controller.findAll)` annab Expressile ainult funktsiooni, ilma objektita. Tavalises meetodis oleks `this` siis `undefined` ja `this.service` annaks vea. Seepärast on controlleri meetodid **noolfunktsioonid klassi väljadena**: nool jätab `this`-i meelde.
- **`:id` kontroll:** ilma selleta läheks `/api/events/abc` andmebaasi, Postgres annaks vea (vigane uuid) ja klient saaks `500`. Zodiga saab ta `400`.
- **`eventRouter.use(requireAuth, requireRole("organizer"))`** kaitseb kõiki selle routeri route'e, ka neid, mis lisatakse hiljem.
- 🟢 Frontendis kutsusid neid aadresse `useCreateEvent`-iga. Nüüd teeme need ise.

## Sammud

1. `src/event/event.controller.ts`:
   ```ts
   import type {RequestHandler} from "express";
   import z from "zod";
   import {StatusCode} from "../shared/http/status-codes.js";
   import {createEventDto} from "./dto/create-event.dto.js";
   import {toEventResponse} from "./dto/event-response.dto.js";
   import type {EventService} from "./event.service.js";

   export const eventIdParams = z.object({id: z.uuid()});

   export class EventController {
       constructor(private readonly service: EventService) {}

       findAll: RequestHandler = async (req, res) => {
           const events = await this.service.findAll(req.user!);
           res.json(events.map(toEventResponse));
       };

       findById: RequestHandler = async (req, res) => {
           const {id} = eventIdParams.parse(req.params);
           const event = await this.service.findOwnedById(id, req.user!);
           res.json(toEventResponse(event));
       };

       create: RequestHandler = async (req, res) => {
           const dto = createEventDto.parse(req.body);
           const event = await this.service.create(dto, req.user!.id);
           res.status(StatusCode.CREATED).json(toEventResponse(event));
       };
   }
   ```
   - `req.user!`: kõik route'id on `requireAuth`-i taga, seega kasutaja on olemas.
   - `201 Created`: loomisel, mitte `200`.
2. `src/event/event.routes.ts`:
   ```ts
   import {Router} from "express";
   import {requireAuth, requireRole} from "../auth/require-auth.middleware.js";
   import {db} from "../db/index.js";
   import {EventController} from "./event.controller.js";
   import {EventRepository} from "./event.repository.js";
   import {EventService} from "./event.service.js";

   const eventRepository = new EventRepository(db);
   const eventService = new EventService(eventRepository);
   const eventController = new EventController(eventService);

   export const eventRouter = Router();

   eventRouter.use(requireAuth, requireRole("organizer"));

   eventRouter.get("/", eventController.findAll);
   eventRouter.get("/:id", eventController.findById);
   eventRouter.post("/", eventController.create);
   ```
3. `src/app.ts`, `meRouter`-i järele:
   ```ts
   app.use("/api/events", eventRouter);
   ```
4. Proovi. Logi testlehel (http://localhost:3000) sisse **organizer** rolliga kasutajaga (#11) ja ava DevToolsi konsool. Sama aadressi pealt saadetud `fetch` saadab sessiooni cookie kaasa:
   ```js
   const body = {
       title: "Rokiõhtu",
       description: "Pikk kirjeldus",
       shortDescription: "Lühike kirjeldus",
       locationName: "Saku Suurhall",
       address: "Paldiski mnt 104b",
       city: "Tallinn",
       startsAt: "2026-12-01T19:00:00+02:00",
       endsAt: "2026-12-01T23:00:00+02:00",
       salesStartAt: "2026-11-01T10:00:00+02:00",
       salesEndAt: "2026-12-01T19:00:00+02:00",
   };
   const res = await fetch("/api/events", {
       method: "POST",
       headers: {"Content-Type": "application/json"},
       body: JSON.stringify(body),
   });
   console.log(res.status, await res.json());
   ```
   Seejärel proovi:
   - `fetch("/api/events")` → `200` ja sinu üritus nimekirjas
   - vale `endsAt` (enne algust) → `400` ja `details.endsAt`
   - `fetch("/api/events/abc")` → `400` (vigane uuid)
   - `fetch("/api/events/" + crypto.randomUUID())` → `404`
   - muuda Studios oma roll `attendee`-ks → `403` kõigil, siis tagasi `organizer`
   - (soovi korral) Postman: kopeeri DevToolsist `better-auth.session_token` cookie päisesse `Cookie`

## Valmis, kui…

- [ ] Loomine annab `201` ja üritus on `draft` olekus
- [ ] Vigased andmed annavad `400` koos `details`-iga
- [ ] Vigane id annab `400`, olematu `404`
- [ ] `attendee` saab `403`, sisselogimata `401`
- [ ] Controlleris pole ühtegi `try/catch`-i

## Mida sa saavutasid

- **Nüüd töötab:** Korraldaja saab API kaudu üritust luua ja oma üritusi vaadata. Kogu ahel töötab: päring → middleware → controller → service → repository → andmebaas.
- **Said selgeks:** Controller on õhuke: valideerib, kutsub service'it ja vormib vastuse. Iga kiht teeb ühte asja.
- **Edasi:** Selle mustri järgi on tehtud kõik ülejäänud moodulid (piletitüübid, tellimused, turvamehed).

## Kontrollküsimused

1. **Miks on controlleri meetodid noolfunktsioonid?** Muidu kaob `this`, kui Express meetodit kutsub.
2. **Miks on `new` ainult routes failis?** Üks koht, kus moodul kokku pannakse; teised klassid saavad sõltuvused konstruktoris ja neid saab testis asendada.
3. **Miks `organizerId` tuleb `req.user`-ist?** Klient ei saa valida, kelle nimele üritus läheb.

## Materjalid

- 📖 [M6 › Kihid: kes mida teeb?](https://vikatgen.github.io/oppematerjalid/veebirakendused/backend/02-kihiline-arhitektuur): route, middleware, controller, service, repository ja miks reeglid on service'is
- [Express: Routing](https://expressjs.com/en/guide/routing.html)
- [MDN: Arrow functions and `this`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/Arrow_functions#cannot_be_used_as_methods)
- [MDN: 201 Created](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/201)

## Sõltub

- #15
