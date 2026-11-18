---
title: 26. Avalikud piletitüübid ja seeder
milestone: M5 – Piletitüübid
labels: api, suurus: M
---

## Eesmärk

Ostja näeb avaldatud ürituse piletitüüpe koos hinna ja **alles oleva kogusega**. Seeder loob igale üritusele piletitüübid.

| Meetod | Aadress | Vastus |
|---|---|---|
| `GET` | `/api/public/events/:eventId/ticket-types` | `200` piletitüübid, `404` üritus pole avaldatud |

## Taust

- **Ostja ei vaja `capacity` ja `sold` eraldi**, vaid "mitu on alles". Avalik DTO arvutab selle: `available = capacity - sold`. Andmebaasis sellist veergu pole: see on **arvutatud väli**.
- Mustandi piletitüübid annavad `404`, nagu mustand ise (#19). Reegli annab `eventService.findPublishedById`: jälle küsime ürituse moodulilt.
- **Seeder (#20) kasvab:** iga üritus saab piletitüübid. `sold` jääb praegu `0`: müüdud piletid tekivad seederisse koos tellimustega (#30), et `sold` ja päris piletite arv klapiksid.
- 🟢 Frontendi ürituse leht näitab neid koos "X piletit alles" tekstiga.

## Sammud

1. `src/ticket-type/dto/public-ticket-type-response.dto.ts`:
   ```ts
   import type {TicketType} from "../../db/schema/ticket-type.schema.js";

   export type PublicTicketTypeResponseDto = {
       id: string;
       name: string;
       priceCents: number;
       available: number;
   };

   export function toPublicTicketTypeResponse(ticketType: TicketType): PublicTicketTypeResponseDto {
       return {
           id: ticketType.id,
           name: ticketType.name,
           priceCents: ticketType.priceCents,
           available: ticketType.capacity - ticketType.sold,
       };
   }
   ```
2. `ticket-type.service.ts`:
   ```ts
   async findAllPublished(eventId: string): Promise<TicketType[]> {
       await this.eventService.findPublishedById(eventId);
       return this.repository.findAllByEventId(eventId);
   }
   ```
3. `ticket-type.controller.ts`:
   ```ts
   findAllPublished: RequestHandler = async (req, res) => {
       const {eventId} = eventParams.parse(req.params);
       const ticketTypes = await this.service.findAllPublished(eventId);
       res.json(ticketTypes.map(toPublicTicketTypeResponse));
   };
   ```
4. `ticket-type.routes.ts`:
   ```ts
   export const publicTicketTypeRouter = Router({mergeParams: true});

   publicTicketTypeRouter.get("/", ticketTypeController.findAllPublished);
   ```
5. `src/app.ts`, **enne** `/api/public/events` rida:
   ```ts
   app.use("/api/public/events/:eventId/ticket-types", publicTicketTypeRouter);
   ```
6. `tests/ticket-type/public-ticket-type.routes.test.ts` (ükski test ei logi sisse): avaldatud ürituse tüübid koos `available`-iga, vastuses pole `capacity` ega `sold`, mustand → `404`.
7. **Seeder:** `src/scripts/seed.ts`, impordi `ticketTypeSchema` ja lisa ürituste järele:
   ```ts
   const ticketTypes = await db
       .insert(ticketTypeSchema)
       .values(
           events.flatMap((event) => [
               {eventId: event.id, name: "Tavapilet", priceCents: 2500, capacity: 100},
               {eventId: event.id, name: "VIP", priceCents: 7500, capacity: 10},
           ]),
       )
       .returning();

   console.log(`Valmis: 6 kasutajat, ${events.length} üritust, ${ticketTypes.length} piletitüüpi`);
   ```
   (Kustuta vana `console.log("Valmis: ...")` rida.) VIP-il on meelega väike kogus: hiljem (#30) müüme selle mõnel üritusel täis.
8. Kontrolli:
   ```bash
   npm run seed
   curl localhost:3000/api/public/events          # võta mõne ürituse id
   curl localhost:3000/api/public/events/<id>/ticket-types
   ```
   `TRUNCATE events CASCADE` (#20) tühjendab ka piletitüübid: seederi kustutamise osa ei muutu.

## Valmis, kui…

- [ ] Avalik route näitab hinda ja `available` välja, mitte `capacity`/`sold`
- [ ] Mustandi piletitüübid annavad `404`
- [ ] `npm run seed` loob igale üritusele 2 piletitüüpi ja on endiselt korratav
- [ ] Testid on rohelised

## Mida sa saavutasid

- **Nüüd töötab:** Ostja näeb ürituse pileteid koos hinna ja alles oleva kogusega. Seeder loob igale üritusele piletitüübid.
- **Said selgeks:** Avalik vastus näitab arvutatud välja (`available`), mitte sisemisi numbreid.
- **Edasi:** Ostjal on nüüd kõik ostmiseks vajalik. Järgmine verstapost teeb ostmise ise.

## Kontrollküsimused

1. **Miks `available` arvutatakse, mitte ei salvestata?** Siis peaks seda iga ostu ja tühistamise juures eraldi uuendama ja see võiks `sold`-iga vastuollu minna.
2. **Miks seederis `sold` on `0`?** Müüdud kogus peab klappima päris piletitega, mis tulevad #30-s.

## Materjalid

- [OWASP API3: Broken Object Property Level Authorization](https://owasp.org/API-Security/editions/2023/en/0xa3-broken-object-property-level-authorization/)

## Sõltub

- #25
