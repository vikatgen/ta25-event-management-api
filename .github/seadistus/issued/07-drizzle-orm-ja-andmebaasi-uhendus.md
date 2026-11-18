---
title: 7. Drizzle ORM ja andmebaasi ühendus
milestone: M0 – Projekti algus
labels: andmebaas, suurus: M
---

## Eesmärk

Rakendus ühendub Postgresiga **Drizzle ORM-i** kaudu ja migratsioonide käsud (`db:generate`, `db:migrate`, `db:studio`) töötavad. Tabeleid veel pole: need tulevad iga issuega, kus neid vaja on.

## Taust

- **ORM** (Object-Relational Mapper) laseb kirjutada andmebaasi päringuid TypeScriptis. Drizzle on "õhuke": näeb välja nagu SQL ja tüübid tulevad skeemist. 🟢 Frontendis `openapi-fetch` andis päringutele tüübid; Drizzle annab need andmebaasile.
- **Skeem** (TypeScript) kirjeldab tabeleid. **Migratsioon** (SQL fail) viib andmebaasi skeemiga kooskõlla. Töövoog on alati sama:
  1. muuda skeemi
  2. `npm run db:generate` → loob SQL faili
  3. loe SQL läbi
  4. `npm run db:migrate` → rakendab selle
- Migratsioonid lähevad gitti: iga arendaja ja server jooksutab samad.
- **`pg.Pool`** hoiab mitu avatud ühendust, et iga päring ei peaks uut avama.
- **`casing: "snake_case"`**: koodis `startsAt`, andmebaasis `starts_at`. Drizzle teisendab ise.
- **`prefix: "timestamp"`**: migratsioonifailid algavad kuupäevaga (`20261021190619_...`), nii on järjekord alati õige.

## Sammud

1. Paigalda:
   ```bash
   npm install drizzle-orm pg
   npm install -D drizzle-kit @types/pg
   ```
2. `src/db/index.ts`:
   ```ts
   import {drizzle} from "drizzle-orm/node-postgres";
   import {Pool} from "pg";
   import {env} from "../config/env.js";

   export const pool = new Pool({
       connectionString: env.DATABASE_URL,
   });

   export const db = drizzle({
       client: pool,
       casing: "snake_case",
   });
   ```
3. `drizzle.config.ts` (projekti juurkausta):
   ```ts
   import {defineConfig} from "drizzle-kit";
   import {env} from "./src/config/env.js";

   export default defineConfig({
       dialect: "postgresql",
       schema: "./src/db/schema",
       casing: "snake_case",
       out: "./migrations",
       dbCredentials: {
           url: env.DATABASE_URL,
       },
       migrations: {
           prefix: "timestamp",
       },
   });
   ```
4. `package.json` skriptid:
   ```json
   "db:generate": "drizzle-kit generate",
   "db:migrate": "drizzle-kit migrate",
   "db:studio": "drizzle-kit studio"
   ```
   Erinevalt `server` skriptist pole siin `--env-file`: `drizzle-kit` loeb `.env` faili ise.
5. `src/server.ts`: kontrolli käivitusel ühendust ja sulge pool sulgemisel.
   ```ts
   import {pool} from "./db/index.js";

   await pool.query("SELECT 1");
   ```
   (`app.listen` ette) ja `shutdown` funktsioonis enne `process.exit(0)`:
   ```ts
   await pool.end();
   ```
   `SELECT 1` on odavaim päring: kui baas on kättesaamatu, kukub server kohe, mitte esimese kasutaja peale.
6. Proovi:
   ```bash
   npm run server          # käivitub
   docker compose stop     # peata baas
   npm run server          # peab kohe veaga kukkuma
   docker compose start
   npm run db:generate     # "No schema changes, nothing to migrate"
   npm run db:studio       # avab brauseris tühja andmebaasi
   ```
7. Lisa README käskude tabelisse kolm `db:*` käsku ja kirjuta üles töövoog (skeem → generate → migrate).
8. Commit:
   ```bash
   git add .
   git commit -m "feat: drizzle orm ja andmebaasi ühendus"
   ```

## Valmis, kui…

- [ ] Server käivitub, kui Postgres töötab, ja kukub arusaadava veaga, kui ei tööta
- [ ] `npm run db:generate` ütleb, et muudatusi pole
- [ ] `npm run db:studio` avaneb brauseris
- [ ] `Ctrl+C` sulgeb ka andmebaasi ühendused (programm lõpeb, ei jää rippuma)

## Mida sa saavutasid

- **Nüüd töötab:** Rakendus ühendub Postgresiga Drizzle ORM-i kaudu ja migratsioonide käsud töötavad.
- **Said selgeks:** Mis on ORM ja migratsioon ning miks tabeleid ei looda käsitsi.
- **Edasi:** Tabeleid veel pole. Esimene migratsioon tuleb järgmises sammus koos kasutajatega.

## Materjalid

- 📖 [M6 › ORM ja migratsioonid](https://vikatgen.github.io/oppematerjalid/veebirakendused/backend/06-orm-ja-migratsioonid): mida ORM teeb, migratsioon kui andmebaasi versioonihaldus, miks vana migratsiooni ei muudeta
- [Drizzle: Get started with PostgreSQL](https://orm.drizzle.team/docs/get-started/postgresql-new)
- [Drizzle: Migrations](https://orm.drizzle.team/docs/migrations)
- [node-postgres: Pooling](https://node-postgres.com/features/pooling)

## Sõltub

- #5
- #6
