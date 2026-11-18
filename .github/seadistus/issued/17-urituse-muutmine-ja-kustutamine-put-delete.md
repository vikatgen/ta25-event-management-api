---
title: 17. Ürituse muutmine ja kustutamine (PUT, DELETE)
milestone: M3 – Üritused
labels: api, suurus: M
---

## Eesmärk

Korraldaja saab oma ürituse andmeid muuta (`PUT`) ja mustandi kustutada (`DELETE`).

| Meetod | Aadress | Vastus |
|---|---|---|
| `PUT` | `/api/events/:id` | `200` muudetud üritus |
| `DELETE` | `/api/events/:id` | `204` kustutatud, `409` pole mustand |

## Taust

- **`PUT` asendab kogu ürituse.** Klient saadab alati terve objekti, seega kasutame sama DTO-d mis loomisel. (`PATCH` muudaks ainult saadetud välju: seda me ei tee, sest frontendi vorm saadab niikuinii kõik.)
- **Drizzle'i lõks:** `UPDATE`-is jäetakse `undefined` väljad **välja**. Kui klient jätab `imageUrl`-i saatmata ("pilti pole"), jääks vana pilt alles. Seepärast `imageUrl ?? null`: `null` tühjendab välja.
- **`status` ja `organizerId` `PUT`-iga ei muutu**: neid DTO-s pole. Olekut muudame eraldi tegevustega (#18).
- **Kustutada saab ainult mustandit.** Avaldatud üritusel võivad olla ostjad: see tühistatakse, mitte ei kustutata. Muidu `409 Conflict`.
- **`204 No Content`:** kustutatud, vastuses pole midagi.

## Sammud

1. `event.repository.ts`:
   ```ts
   async update(id: string, event: Partial<CreateEvent>): Promise<Event | undefined> {
       const [updatedEvent] = await this.db.update(eventSchema).set(event).where(eq(eventSchema.id, id)).returning();
       return updatedEvent;
   }

   async delete(id: string): Promise<void> {
       await this.db.delete(eventSchema).where(eq(eventSchema.id, id));
   }
   ```
   - `Partial<CreateEvent>`: kõik väljad valikulised. Sama meetod sobib ka ainult `status`-e muutmiseks (#18).
   - `undefined`, kui rida vahepeal kadus (keegi kustutas). Service otsustab, et see on `404`.
2. `event.service.ts` (lisa `ConflictError` importi):
   ```ts
   async update(id: string, event: CreateEventDto, user: AuthUser): Promise<Event> {
       await this.findOwnedById(id, user);
       const updated = await this.repository.update(id, {...event, imageUrl: event.imageUrl ?? null});

       if (!updated) {
           throw new NotFoundError("Üritust ei leitud");
       }

       return updated;
   }

   async delete(id: string, user: AuthUser): Promise<void> {
       const event = await this.findOwnedById(id, user);

       if (event.status !== "draft") {
           throw new ConflictError("Kustutada saab ainult mustandit");
       }

       await this.repository.delete(id);
   }
   ```
   `findOwnedById` kõigepealt: võõrast üritust ei saa muuta ega kustutada (`403`).
3. `event.controller.ts`:
   ```ts
   update: RequestHandler = async (req, res) => {
       const {id} = eventIdParams.parse(req.params);
       const dto = createEventDto.parse(req.body);
       const event = await this.service.update(id, dto, req.user!);
       res.json(toEventResponse(event));
   };

   delete: RequestHandler = async (req, res) => {
       const {id} = eventIdParams.parse(req.params);
       await this.service.delete(id, req.user!);
       res.status(StatusCode.NO_CONTENT).end();
   };
   ```
4. `event.routes.ts`:
   ```ts
   eventRouter.put("/:id", eventController.update);
   eventRouter.delete("/:id", eventController.delete);
   ```
5. Proovi konsoolist (vt #16):
   - muuda pealkirja → `200`, `updatedAt` muutus
   - saada ilma `imageUrl`-ita üritusele, millel oli pilt → `imageUrl: null`
   - kustuta mustand → `204`, siis `GET` → `404`
   - teise korraldaja üritus (loo Studios teine kasutaja ja muuda `organizer_id`) → `403`
   - avaldatud üritust saad kustutada proovida alles pärast #18: märgi see üles

## Valmis, kui…

- [ ] `PUT` muudab kõik väljad ja saatmata `imageUrl` tühjendab pildi
- [ ] Mustandi kustutamine annab `204`
- [ ] Võõra ürituse muutmine/kustutamine annab `403`

## Mida sa saavutasid

- **Nüüd töötab:** Korraldaja saab oma üritust muuta ja mustandit kustutada.
- **Said selgeks:** `PUT` asendab kogu ressursi, `204` tähendab, et õnnestus, aga sisu pole, ja `409` tähendab, et praeguses olekus ei saa seda teha.
- **Edasi:** Olekut (`draft`/`published`) ei muudeta `PUT`-iga. Selleks tuleb järgmises sammus eraldi tegevus.

## Kontrollküsimused

1. **Miks `imageUrl ?? null`?** Drizzle jätab `undefined` `UPDATE`-ist välja, vana pilt jääks alles.
2. **Miks avaldatud üritust ei saa kustutada?** Sellel võivad olla ostjad ja piletid.
3. **Mis vahe on `PUT`-il ja `PATCH`-il?** `PUT` asendab kogu objekti, `PATCH` muudab osa.

## Materjalid

- [Drizzle: Update](https://orm.drizzle.team/docs/update)
- [MDN: PUT](https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods/PUT) · [PATCH](https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods/PATCH)

## Sõltub

- #16
