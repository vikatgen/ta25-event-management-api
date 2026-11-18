---
title: 42. Lehekülgedeks jagamine (limit ja offset)
milestone: M10 – Kvaliteet
labels: api, suurus: M
---

## Eesmärk

Kõik nimekirjad on lehekülgedeks jagatud: `?limit=20&offset=40` → read 41–60. Ükski päring ei tagasta tervet tabelit.

| Aadress | |
|---|---|
| `GET /api/public/events` | avalikud üritused |
| `GET /api/events` | minu üritused (admin: kõik) |
| `GET /api/orders/me` | minu tellimused |
| `GET /api/admin/users` | kasutajad |

## Taust

- **Ilma piiranguta tagastaks nimekiri KÕIK read:** 100 000 üritust ühes vastuses. Server, andmebaas ja brauser kannataksid (OWASP API4).
- **`limit` ja `offset`:** mitu rida ja mitu jätta vahele. Vaikimisi 20, maksimaalselt 100: klient ei saa küsida `?limit=1000000`.
- **`z.coerce`:** URL-i parameetrid on alati stringid (`"20"`), `coerce` teeb neist numbri. Vigane väärtus → `400`.
- **Järjekord on lehekülgedeks jagamisel kohustuslik:** ilma `orderBy`-ta võib sama rida sattuda kahele lehele või mitte ühelegi. Selle tegime juba #15-s ja #30-s.
- **Piletitüüpe ja turvamehi ei jaga:** neid on ühel üritusel paar tükki.
- 🟢 Frontendi avaleht ("Ürituste kaardid ja lehekülgedeks jagamine") kasutab `limit` ja `offset` parameetreid.

## Sammud

1. `src/shared/validation/pagination.ts`:
   ```ts
   import z from "zod";

   export const paginationQuery = z.object({
       limit: z.coerce.number().int().min(1).max(100).default(20),
       offset: z.coerce.number().int().min(0).default(0),
   });

   export type Pagination = z.infer<typeof paginationQuery>;
   ```
2. Repository'd: lisa parameeter `{limit, offset}: Pagination` ja päringu lõppu `.limit(limit).offset(offset)`:
   - `EventRepository`: `findAll`, `findAllByOrganizerId`, `findAllPublished`
   - `OrderRepository`: `findAllByUserId` (ainult tellimuste päringule, piletite päring jääb samaks)
   - `UserRepository`: `findAll`
   ```ts
   async findAllPublished({limit, offset}: Pagination): Promise<Event[]> {
       return this.db
           .select()
           .from(eventSchema)
           .where(eq(eventSchema.status, "published"))
           .orderBy(asc(eventSchema.startsAt), asc(eventSchema.id))
           .limit(limit)
           .offset(offset);
   }
   ```
3. Service'id annavad `pagination` edasi (`findAll(user, pagination)`, `findMine(user, pagination)` jne).
4. Controllerid:
   ```ts
   const events = await this.service.findAllPublished(paginationQuery.parse(req.query));
   ```
5. Testid:
   - `public-event.routes.test.ts`: 3 avaldatud üritust, `?limit=2` → 2, `?limit=2&offset=2` → 1; `?limit=101` → `400`
   - uuenda `event.service.test.ts`: `findAllByOrganizerId` kutsutakse `(organizer.id, page)`-ga
   - (soovi korral) `?limit=abc` → `400`
6. Proovi seederiga: `curl "localhost:3000/api/public/events?limit=2"` ja `?limit=2&offset=2`.

## Valmis, kui…

- [ ] Kõik 4 nimekirja võtavad `limit` ja `offset` parameetri
- [ ] Vaikimisi tuleb 20 rida, üle 100 annab `400`
- [ ] Testid on rohelised

## Mida sa saavutasid

- **Nüüd töötab:** Ükski nimekiri ei tagasta enam tervet tabelit.
- **Said selgeks:** `limit` ja `offset`, vaikeväärtused ja ülempiir, mis kaitseb serverit liiga suure päringu eest.
- **Edasi:** Samm 46 kontrollib seda 10 000 üritusega.

## Kontrollküsimused

1. **Miks `max(100)`?** Klient ei tohi saada küsida piiramatult ridu.
2. **Miks `orderBy` on lehekülgedeks jagamisel kohustuslik?** Muidu võib järjekord päringute vahel muutuda.
3. **Miks `z.coerce`?** Päringu parameetrid on alati stringid.

## Materjalid

- 📖 [M6 › API turvalisus](https://vikatgen.github.io/oppematerjalid/veebirakendused/backend/11-api-turvalisus): päritolu ja CORS, CSRF, päringute piirang, OWASP API Top 10
- [Drizzle: Limit & offset pagination](https://orm.drizzle.team/docs/guides/limit-offset-pagination)
- [OWASP API4: Unrestricted Resource Consumption](https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/)

## Sõltub

- #41
