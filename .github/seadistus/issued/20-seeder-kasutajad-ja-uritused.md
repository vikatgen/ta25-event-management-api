---
title: 20. Seeder: kasutajad ja üritused
milestone: M3 – Üritused
labels: andmebaas, suurus: M
---

## Eesmärk

Üks käsk täidab andmebaasi näidisandmetega: kasutajad kõigis rollides ja üritused kõigis olekutes. Seeder kasvab iga järgmise mooduliga (piletitüübid, tellimused, turvamehed), nii et lõpuks saab terve rakenduse läbi mängida.

```bash
npm run seed                       # ainult näidisandmed
npm run seed -- sinu@gmail.com     # + sinust saab admin
```

## Taust

- Käsitsi loodud andmetega on raske kõiki olukordi proovida: tühistatud üritus, möödunud üritus, müük pole veel alanud. **Seeder loob need ühe käsuga ja alati samamoodi.**
- **Korratav:** iga käivitus alustab puhtalt. `TRUNCATE events CASCADE` tühjendab ürituste tabeli **ja kõik tabelid, mis sellele viitavad** (hiljem piletitüübid, tellimused, piletid). Seepärast ei pea hilisemad issued kustutamise järjekorda muutma.
  > ⚠️ See kustutab **kõik** üritused, ka käsitsi loodud. Seeder on ainult arenduseks: tootmises keeldub ta käivitumast.
- **Seeditud kasutajad ei saa sisse logida**, sest sisselogimine käib ainult Google'i/GitHubiga. Seepärast saab seederile anda oma e-posti: sinu päris kasutaja (pead olema korra sisse loginud) saab admini rolli ja pääseb igale poole.
- **Ajad on arvutatud praegusest hetkest**, mitte kindlad kuupäevad. Nii on "tulevane üritus" alati tulevikus, ka järgmisel aastal.
- `console.log` on siin lubatud (#3 lint-erand `src/scripts/**`): väljund on inimesele.

| Üritus | Olek | Mida sellega proovida |
|---|---|---|
| Rokiõhtu (Tallinn) | `published` | tavaline ost |
| Jazzi õhtu (Tartu) | `published` | teine korraldaja |
| Tehnoloogiakonverents | `published`, müük algab 7 p pärast | "müük pole alanud" |
| Elektroonilise muusika öö | `published`, algab ~2 h pärast | skännimine uksel (#40) |
| Suvefestival | `draft` | avaldamine, kustutamine |
| Tühistatud kontsert | `cancelled` | ei ole avalikus nimekirjas |
| Ooperigala | `completed`, möödunud | ajalugu |

## Sammud

1. `src/scripts/seed.ts`:
   ```ts
   import {eq, like, sql} from "drizzle-orm";
   import type {Role} from "../auth/roles.js";
   import {env} from "../config/env.js";
   import {db, pool} from "../db/index.js";
   import {user} from "../db/schema/auth.js";
   import {type CreateEvent, type EventStatusEnum, eventSchema} from "../db/schema/event.schema.js";
   import {UnexpectedError} from "../shared/errors/unexpected.error.js";

   if (env.NODE_ENV === "production") {
       console.error("Seederit ei käivitata tootmises");
       process.exit(1);
   }

   const HOUR = 60 * 60 * 1000;
   const DAY = 24 * HOUR;
   const now = Date.now();

   type Venue = Pick<CreateEvent, "locationName" | "address" | "city">;

   const SAKU: Venue = {locationName: "Saku Suurhall", address: "Paldiski mnt 104b", city: "Tallinn"};
   const VANEMUINE: Venue = {locationName: "Vanemuise Kontserdimaja", address: "Vanemuise 6", city: "Tartu"};
   const KATEL: Venue = {locationName: "Kultuurikatel", address: "Põhja pst 27a", city: "Tallinn"};

   async function createUser(name: string, email: string, role: Role) {
       const [created] = await db.insert(user).values({name, email, emailVerified: true, role}).returning();
       if (!created) throw new UnexpectedError("Kasutajat ei loodud");
       return created;
   }

   function buildEvent(
       title: string,
       status: EventStatusEnum,
       startsInDays: number,
       organizerId: string,
       venue: Venue,
       salesStartInDays = startsInDays - 30,
   ): CreateEvent {
       const startsAt = new Date(now + startsInDays * DAY);
       return {
           title,
           shortDescription: `${title}: ${venue.locationName}`,
           description: `${title} toimub kohas ${venue.locationName} (${venue.address}, ${venue.city}).`,
           imageUrl: `https://picsum.photos/seed/${encodeURIComponent(title)}/800/450`,
           ...venue,
           startsAt,
           endsAt: new Date(startsAt.getTime() + 4 * HOUR),
           salesStartAt: new Date(now + salesStartInDays * DAY),
           salesEndAt: startsAt,
           status,
           organizerId,
       };
   }

   const realUserEmail = process.argv[2];

   if (realUserEmail) {
       const [realUser] = await db
           .update(user)
           .set({role: "admin"})
           .where(eq(user.email, realUserEmail))
           .returning();
       if (!realUser) {
           console.error(`Kasutajat ${realUserEmail} pole. Logi enne korra sisse.`);
           process.exit(1);
       }
       console.log(`${realUserEmail} on nüüd admin`);
   }

   await db.execute(sql`TRUNCATE TABLE ${eventSchema} CASCADE`);
   await db.delete(user).where(like(user.email, "%@seed.test"));

   const organizerA = await createUser("Kati Korraldaja", "organizer-a@seed.test", "organizer");
   const organizerB = await createUser("Mart Korraldaja", "organizer-b@seed.test", "organizer");
   await createUser("Siim Turvamees", "security@seed.test", "security");
   await createUser("Anu Ostja", "attendee-a@seed.test", "attendee");
   await createUser("Peeter Ostja", "attendee-b@seed.test", "attendee");
   await createUser("Admin", "admin@seed.test", "admin");

   const events = await db
       .insert(eventSchema)
       .values([
           buildEvent("Rokiõhtu", "published", 14, organizerA.id, SAKU),
           buildEvent("Jazzi õhtu", "published", 30, organizerB.id, VANEMUINE),
           buildEvent("Tehnoloogiakonverents", "published", 60, organizerA.id, KATEL, 7),
           buildEvent("Elektroonilise muusika öö", "published", 2 / 24, organizerB.id, KATEL),
           buildEvent("Suvefestival", "draft", 90, organizerA.id, SAKU),
           buildEvent("Tühistatud kontsert", "cancelled", 20, organizerB.id, VANEMUINE),
           buildEvent("Ooperigala", "completed", -30, organizerA.id, VANEMUINE),
       ])
       .returning();

   console.log(`Valmis: 6 kasutajat, ${events.length} üritust`);
   await pool.end();
   ```
   - `createUser` eraldi funktsioon: `insert().returning()` tagastab massiivi ja nii saame iga kasutaja otse muutujasse.
   - `salesStartInDays` vaikimisi 30 päeva enne algust, nii et müügi algus on alati enne lõppu.
   - `2 / 24` päeva = 2 tundi.
   - `pool.end()`: muidu jääb skript ühenduste pärast rippuma.
2. `package.json`:
   ```json
   "seed": "tsx --env-file=.env src/scripts/seed.ts"
   ```
3. Käivita ja kontrolli:
   ```bash
   npm run seed -- sinu@gmail.com
   ```
   - Studio: 6 `@seed.test` kasutajat ja 7 üritust
   - `curl localhost:3000/api/public/events`: ainult 4 avaldatud üritust
   - testlehel sisse logides: `GET /api/events` näitab admini õigusega kõiki 7
   - käivita teist korda: tulemus on sama, mitte topelt
4. Lisa README käskude tabelisse `npm run seed -- [email]` ja hoiatus, et see kustutab kõik üritused.

> **Edasi:** iga moodul, mis lisab tabeli, lisab ka seederisse oma osa (piletitüübid #26, tellimused ja piletid #30, turvamehed #38, skännitud piletid #40). Lõpus (#45) kontrollime, et seeder katab kõik olukorrad.

## Valmis, kui…

- [ ] `npm run seed` loob kasutajad kõigis rollides ja üritused kõigis olekutes
- [ ] Teine käivitus annab sama tulemuse (ei topelda)
- [ ] E-postiga käivitades saab päris kasutaja admini rolli, olematu e-post annab selge vea
- [ ] `NODE_ENV=production` korral seeder keeldub

## Mida sa saavutasid

- **Nüüd töötab:** Üks käsk täidab andmebaasi näidisandmetega kõigis rollides ja olekutes ning teeb sinust admini.
- **Said selgeks:** Seeder peab olema **korratav** (teine käivitus ei topelda) ja tootmises keelatud.
- **Edasi:** Seeder kasvab iga mooduliga. Järgmine verstapost lisab testid, mis kontrollivad tehtut automaatselt.

## Kontrollküsimused

1. **Miks `TRUNCATE ... CASCADE`, mitte `DELETE` iga tabeli kohta?** Tühjendab ka viitavad tabelid ja hilisemad moodulid ei pea kustutamise järjekorda muutma.
2. **Miks ajad on arvutatud praegusest hetkest?** "Tulevane üritus" jääb alati tulevikku.
3. **Miks seeditud kasutajad ei saa sisse logida?** Login on ainult OAuth: neil pole Google'i kontot.

## Materjalid

- [Drizzle: Insert many rows](https://orm.drizzle.team/docs/insert#insert-multiple-rows)
- [Drizzle: Magic sql operator](https://orm.drizzle.team/docs/sql)
- [PostgreSQL: TRUNCATE](https://www.postgresql.org/docs/current/sql-truncate.html)

## Sõltub

- #19
