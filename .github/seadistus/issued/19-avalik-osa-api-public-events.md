---
title: 19. Avalik osa: /api/public/events
milestone: M3 – Üritused
labels: api, suurus: M
---

## Eesmärk

Igaüks, ka sisselogimata ostja, näeb **avaldatud** üritusi:

| Meetod | Aadress | Vastus |
|---|---|---|
| `GET` | `/api/public/events` | `200` avaldatud üritused |
| `GET` | `/api/public/events/:id` | `200` üritus, `404` kui pole olemas **või pole avaldatud** |

## Taust

- **Kaks eraldi aadressi**, sest kasutajad ja reeglid on erinevad:

  | | `/api/public/events` | `/api/events` |
  |---|---|---|
  | kes | igaüks | korraldaja, admin |
  | mida näeb | ainult `published` | enda (admin: kõik) olekud |
  | vastus | ilma sisemiste väljadeta | kõik väljad |

- **Avalik vastus on teine DTO:** `organizerId`, `status` ja ajatemplid on sisemised andmed. Ostja neid ei vaja.
- **Mustand annab `404`, mitte `403`.** `403` ütleks "see on olemas, aga sa ei tohi" ja reedaks, et selline mustand on olemas. `404` ei reeda midagi.
- Sama service ja repository, uued meetodid. Routes failist tuleb kaks routerit: üks kaitsega, teine ilma.
- 🟢 Frontendi avaleht (`useEvents`) ja ürituse leht kasutavad just neid aadresse.

## Sammud

1. `src/event/dto/public-event-response.dto.ts`:
   ```ts
   import type {Event} from "../../db/schema/event.schema.js";

   export type PublicEventResponseDto = {
       id: string;
       title: string;
       description: string;
       shortDescription: string;
       imageUrl: string | null;
       locationName: string;
       address: string;
       city: string;
       startsAt: string;
       endsAt: string;
       salesStartAt: string;
       salesEndAt: string;
   };

   export function toPublicEventResponse(event: Event): PublicEventResponseDto {
       return {
           id: event.id,
           title: event.title,
           description: event.description,
           shortDescription: event.shortDescription,
           imageUrl: event.imageUrl,
           locationName: event.locationName,
           address: event.address,
           city: event.city,
           startsAt: event.startsAt.toISOString(),
           endsAt: event.endsAt.toISOString(),
           salesStartAt: event.salesStartAt.toISOString(),
           salesEndAt: event.salesEndAt.toISOString(),
       };
   }
   ```
2. `event.repository.ts`:
   ```ts
   async findAllPublished(): Promise<Event[]> {
       return this.db
           .select()
           .from(eventSchema)
           .where(eq(eventSchema.status, "published"))
           .orderBy(asc(eventSchema.startsAt), asc(eventSchema.id));
   }
   ```
3. `event.service.ts`:
   ```ts
   async findAllPublished(): Promise<Event[]> {
       return this.repository.findAllPublished();
   }

   async findPublishedById(id: string): Promise<Event> {
       const event = await this.findById(id);

       if (event.status !== "published") {
           throw new NotFoundError("Üritust ei leitud");
       }

       return event;
   }
   ```
4. `event.controller.ts`:
   ```ts
   findAllPublished: RequestHandler = async (req, res) => {
       const events = await this.service.findAllPublished();
       res.json(events.map(toPublicEventResponse));
   };

   findPublishedById: RequestHandler = async (req, res) => {
       const {id} = eventIdParams.parse(req.params);
       const event = await this.service.findPublishedById(id);
       res.json(toPublicEventResponse(event));
   };
   ```
5. `event.routes.ts`, enne `eventRouter`-it:
   ```ts
   export const publicEventRouter = Router();

   publicEventRouter.get("/", eventController.findAllPublished);
   publicEventRouter.get("/:id", eventController.findPublishedById);
   ```
6. `src/app.ts`, enne `/api/events` rida:
   ```ts
   app.use("/api/public/events", publicEventRouter);
   ```
7. Proovi **sisselogimata** (privaatne aken või `curl`):
   ```bash
   curl localhost:3000/api/public/events
   curl -i localhost:3000/api/public/events/<mustandi id>     # 404
   ```
   Vastuses ei tohi olla `organizerId`, `status` ega `createdAt`.

## Valmis, kui…

- [ ] Nimekirjas on ainult avaldatud üritused ja sisselogimist pole vaja
- [ ] Mustandi ja tühistatud ürituse id annab `404`
- [ ] Avalikus vastuses pole sisemisi välju

## Mida sa saavutasid

- **Nüüd töötab:** Igaüks näeb avaldatud üritusi ilma sisse logimata. Mustandid ja tühistatud üritused jäävad peitu.
- **Said selgeks:** Avalik ja halduse API on eraldi route'id ja eraldi DTO-d: avalikus vastuses pole sisemisi välju.
- **Edasi:** Rakendusel on esimene täielik tsükkel: korraldaja loob ja avaldab, ostja näeb.

## Kontrollküsimused

1. **Miks mustand annab `404`, mitte `403`?** `403` reedaks, et selline üritus on olemas.
2. **Miks eraldi DTO?** Ostja ei vaja sisemisi välju ja need ei tohi lekkida.
3. **Miks eraldi router, mitte `if (req.user)` sama route'i sees?** Reeglid on erinevad ja kaitse on routeri tasemel selgelt näha.

## Materjalid

- 📖 [M6 › Päringu ja vastuse tsükkel](https://vikatgen.github.io/oppematerjalid/veebirakendused/backend/01-paringu-ja-vastuse-tsukkel): päring, vastus, staatusekoodid, miks server ei mäleta eelmist päringut
- 📖 [M6 › DTO: mis tohib sisse ja välja minna?](https://vikatgen.github.io/oppematerjalid/veebirakendused/backend/03-dto): sisend- ja väljund-DTO, valideerimine vs äriloogika
- [OWASP API3: Broken Object Property Level Authorization](https://owasp.org/API-Security/editions/2023/en/0xa3-broken-object-property-level-authorization/)

## Sõltub

- #18
