---
title: 46. Jõudluse seeder (10 000 üritust)
milestone: M10 – Kvaliteet
labels: andmebaas, suurus: M
---

## Eesmärk

Teine seeder loob **jõudluse proovimiseks** palju andmeid: 10 000 üritust (või muu kogus) koos piletitüüpidega. Sellega näeb, kas lehekülgedeks jagamine ja päringud töötavad ka suure andmehulga juures.

```bash
npm run seed:events             # 10 000 üritust
npm run seed:events -- 50000    # muu kogus
```

## Taust

- **Näidisandmete seeder (#45)** on väike ja käsitsi läbimõeldud. **Jõudluse seeder** on suur ja juhuslik.
- **Korratav juhuslikkus:** `Math.random()` annab iga kord erinevad andmed ja mõõtmisi ei saa võrrelda. **Seemnega** juhuarvude generaator (`mulberry32(42)`) annab iga kord samad "juhuslikud" andmed.
- **Partiidena:** 10 000 rida ühes `INSERT`-is ei mahu Postgresi parameetrite piiri (65 535). 1000 rida × 16 veergu jääb sellest kaugele alla.
- **Olek ja aeg peavad sobima:** `completed` on minevikus, `draft` ja enamik `published` tulevikus.
- **Korratav:** kustutab eelmise käivituse andmed (ainult oma korraldajad `seed-organizer-*@seed.test` ja nende üritused). Näidisandmeid (#45) see ei puutu.
- Kaks seederit võib käivitada järjest: kõigepealt `seed`, siis `seed:events`. (`seed` kustutab omakorda kõik üritused, ka jõudluse omad.)

## Sammud

1. `src/scripts/seed-events.ts`:
   ```ts
   import {inArray, like} from "drizzle-orm";
   import {db, pool} from "../db/index.js";
   import {user} from "../db/schema/auth.js";
   import {type CreateEvent, type EventStatusEnum, eventSchema} from "../db/schema/event.schema.js";
   import {type CreateTicketType, ticketTypeSchema} from "../db/schema/ticket-type.schema.js";

   const count = Number(process.argv[2] ?? 10_000);

   if (!Number.isInteger(count) || count < 1) {
       console.error("Kasutus: npm run seed:events -- [kogus]");
       process.exit(1);
   }

   const ORGANIZER_COUNT = 20;
   const SEED_EMAIL_PATTERN = "seed-organizer-%@seed.test";
   const BATCH_SIZE = 1000;
   const HOUR = 60 * 60 * 1000;
   const DAY = 24 * HOUR;

   function mulberry32(seed: number) {
       return () => {
           seed = (seed + 0x6d2b79f5) | 0;
           let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
           t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
           return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
       };
   }

   const random = mulberry32(42);
   const int = (min: number, max: number) => Math.floor(random() * (max - min + 1)) + min;
   const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;

   function weighted<T>(options: readonly (readonly [T, number])[]): T {
       const total = options.reduce((sum, [, weight]) => sum + weight, 0);
       let roll = random() * total;
       for (const [value, weight] of options) {
           roll -= weight;
           if (roll < 0) return value;
       }
       return options[options.length - 1]![0];
   }
   ```
   `mulberry32` on väike tuntud algoritm: seda ei pea lahti mõtestama, piisab teadmisest, et sama seeme annab sama jada.
2. Andmed (kategooriad, kohad, piletitüübid) ja ehitajad:
   ```ts
   const TITLES = ["Rokiõhtu", "Jazzi õhtu", "Suvefestival", "Tehnoloogiakonverents", "Komöödiaõhtu", "Jooksumaraton"] as const;
   const VENUES = [
       {city: "Tallinn", locationName: "Saku Suurhall", address: "Paldiski mnt 104b"},
       {city: "Tartu", locationName: "Vanemuise Kontserdimaja", address: "Vanemuise 6"},
       {city: "Pärnu", locationName: "Pärnu Kontserdimaja", address: "Aida 4"},
   ] as const;
   const TICKET_TIERS = [
       {name: "Sooduspilet", priceCents: [500, 2000]},
       {name: "Tavapilet", priceCents: [1500, 5000]},
       {name: "VIP", priceCents: [6000, 25000]},
   ] as const;

   function buildEvent(index: number, organizerIds: string[], now: number): CreateEvent {
       const status = weighted<EventStatusEnum>([["published", 60], ["draft", 20], ["completed", 12], ["cancelled", 8]]);
       const venue = pick(VENUES);
       const startsAt = new Date(now + (status === "completed" ? -int(1, 365) : int(-30, 365)) * DAY + int(10, 21) * HOUR);
       const salesEndAt = new Date(startsAt.getTime() - int(0, 24) * HOUR);
       const title = `${pick(TITLES)} ${venue.city}s #${index + 1}`;

       return {
           title,
           shortDescription: `${title} kohas ${venue.locationName}.`,
           description: `${title} toimub kohas ${venue.locationName} (${venue.address}, ${venue.city}).`,
           imageUrl: random() < 0.7 ? `https://picsum.photos/seed/event-${index + 1}/800/450` : null,
           ...venue,
           startsAt,
           endsAt: new Date(startsAt.getTime() + int(1, 5) * HOUR),
           salesStartAt: new Date(salesEndAt.getTime() - int(7, 120) * DAY),
           salesEndAt,
           status,
           organizerId: pick(organizerIds),
       };
   }

   function buildTicketTypes(eventId: string): CreateTicketType[] {
       return [...TICKET_TIERS]
           .sort(() => random() - 0.5)
           .slice(0, int(1, 3))
           .map((tier) => ({
               eventId,
               name: tier.name,
               priceCents: int(tier.priceCents[0] / 100, tier.priceCents[1] / 100) * 100,
               capacity: pick([20, 50, 100, 250, 500, 1000]),
           }));
   }
   ```
   Siin on `sold = 0`: jõudluse seeder pileteid ei loo, nii et `sold` klapib (#45 reegel).
3. Käivitus tehingus:
   ```ts
   const startedAt = performance.now();

   await db.transaction(async (tx) => {
       const old = await tx.select({id: user.id}).from(user).where(like(user.email, SEED_EMAIL_PATTERN));
       if (old.length > 0) {
           const oldIds = old.map((organizer) => organizer.id);
           await tx.delete(eventSchema).where(inArray(eventSchema.organizerId, oldIds));
           await tx.delete(user).where(inArray(user.id, oldIds));
       }

       const organizers = await tx
           .insert(user)
           .values(
               Array.from({length: ORGANIZER_COUNT}, (_, i) => ({
                   name: `Seed Korraldaja ${i + 1}`,
                   email: `seed-organizer-${i + 1}@seed.test`,
                   emailVerified: true,
                   role: "organizer" as const,
               })),
           )
           .returning({id: user.id});
       const organizerIds = organizers.map((organizer) => organizer.id);
       const now = Date.now();

       for (let offset = 0; offset < count; offset += BATCH_SIZE) {
           const batch = Array.from({length: Math.min(BATCH_SIZE, count - offset)}, (_, i) =>
               buildEvent(offset + i, organizerIds, now),
           );
           const events = await tx.insert(eventSchema).values(batch).returning({id: eventSchema.id});
           await tx.insert(ticketTypeSchema).values(events.flatMap((event) => buildTicketTypes(event.id)));
           console.log(`${offset + events.length}/${count} üritust`);
       }
   });

   console.log(`Valmis (${((performance.now() - startedAt) / 1000).toFixed(1)} s)`);
   await pool.end();
   ```
   Tehing: kui midagi kukub poole peal, ei jää pooleldi täidetud andmeid.
4. `package.json`: `"seed:events": "tsx --env-file=.env src/scripts/seed-events.ts"`
5. **Mõõda:**
   ```bash
   npm run seed:events
   time curl -s "localhost:3000/api/public/events?limit=20&offset=0" > /dev/null
   time curl -s "localhost:3000/api/public/events?limit=20&offset=9000" > /dev/null
   ```
   Drizzle Studios või `psql`-is:
   ```sql
   EXPLAIN ANALYZE SELECT * FROM events WHERE status = 'published' ORDER BY starts_at, id LIMIT 20 OFFSET 9000;
   ```
   Kas näed `Seq Scan`? Mis juhtuks miljoni reaga? (Arutelu: indeks `(status, starts_at, id)` ja miks suur `offset` on aeglane. Indeksit me selles projektis ei lisa.)
6. README: `seed:events` käsk ja märkus, et see on jõudluseks, mitte läbimängimiseks.

## Valmis, kui…

- [ ] `npm run seed:events` loob 10 000 üritust alla minutiga
- [ ] Iga käivitus annab samad andmed (seeme) ja on korratav
- [ ] Avalik nimekiri vastab suure andmehulgaga lehekülgedeks jagatult
- [ ] `EXPLAIN ANALYZE` tulemus on läbi arutatud

## Mida sa saavutasid

- **Nüüd töötab:** Andmebaasis on 10 000 üritust ja näed, kuidas päringud suure andmehulgaga käituvad.
- **Said selgeks:** `EXPLAIN ANALYZE` näitab, kuidas andmebaas päringut täidab ja kus on vaja indeksit.
- **Edasi:** Väikese andmehulgaga on kõik kiire. Probleemid ilmnevad alles mahu juures.

## Kontrollküsimused

1. **Miks seemnega juhuslikkus?** Iga käivitus annab samad andmed ja mõõtmised on võrreldavad.
2. **Miks partiidena?** Ühes päringus võib olla kuni 65 535 parameetrit.
3. **Miks suur `offset` on aeglane?** Andmebaas peab vahele jäetud read ikkagi läbi käima.

## Materjalid

- [PostgreSQL: EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html)
- [Use The Index, Luke: Paging through results](https://use-the-index-luke.com/sql/partial-results/fetch-next-page)

## Sõltub

- #45
