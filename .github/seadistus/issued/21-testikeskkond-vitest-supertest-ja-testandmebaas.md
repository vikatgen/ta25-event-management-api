---
title: 21. Testikeskkond: Vitest, supertest ja testandmebaas
milestone: M4 – Testid
labels: test, suurus: L
---

## Eesmärk

`npm test` käivitab automaattestid **eraldi testandmebaasi** peal. Testis saab sisse logida mis tahes rolliga ilma Google'ita. Esimene test kontrollib, et keskkond ise on õige.

## Taust

```
npm test → vitest.config.ts (.env.test) → global-setup.ts (1x) → setup.ts (iga fail) → *.test.ts
```

- **Testid ei tohi kunagi puutuda arendusbaasi**, sest need tühjendavad iga testi eel tabelid. Seepärast on testidel oma Postgres (port `5433`) ja oma `.env.test`. `global-setup.ts` kontrollib enne igat käivitust, et baasi nimi lõpeb `_test`-iga.
- **Testandmebaas on mälus** (`tmpfs`): kiire ja iga `docker compose up` alustab puhtalt.
- **`.env.test` läheb gitti:** seal pole päris saladusi, ainult näivväärtused (`GOOGLE_CLIENT_ID=test`).
- **Skeem tuleb päris migratsioonidest** (`migrate(...)`): testibaas on alati täpselt sama mis arenduses.
- **Iga test algab tühjast baasist** (`TRUNCATE` iga testi eel). Testid ei sõltu üksteisest ega järjekorrast.
- **Sisselogimine testis:** Better Authi `testUtils` plugin loob kasutaja ja **päris** sessiooni. `requireAuth` teeb testis sama tööd mis päriselt. Plugin on ainult testirežiimis: see oskab luua sessiooni ükskõik kellele, tootmises oleks see turvaauk.
- **Vitest + supertest:** Vitest jooksutab teste, supertest saadab päringuid `app`-ile ilma serverit käivitamata. Nüüd tasub ära, et `app.ts` ja `server.ts` on eraldi (#1). 🟢 Vitesti kasutasid ka frontendis.

## Sammud

1. Paigalda:
   ```bash
   npm install -D vitest supertest @types/supertest
   ```
2. `docker-compose.yaml`, teine teenus:
   ```yaml
   postgres-test:
     image: postgres:16-alpine
     container_name: postgres-database-test
     environment:
       POSTGRES_USER: test
       POSTGRES_PASSWORD: test
       POSTGRES_DB: app_test
     ports:
       - "127.0.0.1:5433:5432"
     tmpfs:
       - /var/lib/postgresql/data
   ```
   ```bash
   docker compose up -d postgres-test
   ```
3. `.env.test` (commit'itakse):
   ```
   NODE_ENV=test
   PORT=3001
   DATABASE_URL=postgres://test:test@localhost:5433/app_test
   BETTER_AUTH_SECRET=test-secret-only-for-tests-not-for-production
   BETTER_AUTH_URL=http://localhost:3001
   GOOGLE_CLIENT_ID=test
   GOOGLE_CLIENT_SECRET=test
   GITHUB_CLIENT_ID=test
   GITHUB_CLIENT_SECRET=test
   ```
   > Edaspidi: **iga uus muutuja `env.ts`-is tuleb lisada ka `.env.test`-i**, muidu testid ei käivitu.
4. `vitest.config.ts`:
   ```ts
   import {readFileSync} from "node:fs";
   import {parseEnv} from "node:util";
   import {defineConfig} from "vitest/config";

   Object.assign(process.env, parseEnv(readFileSync(".env.test", "utf8")));

   export default defineConfig({
       test: {
           include: ["tests/**/*.test.ts"],
           globalSetup: ["tests/global-setup.ts"],
           setupFiles: ["tests/setup.ts"],
           fileParallelism: false,
       },
   });
   ```
   - `Object.assign` kirjutab üle ka shellis olemas olevad väärtused: testid ei saa kogemata arendusbaasi peale minna.
   - `fileParallelism: false`: kõik failid kasutavad sama baasi, seega järjest.
5. `tests/global-setup.ts` (üks kord enne kõiki teste):
   ```ts
   import {migrate} from "drizzle-orm/node-postgres/migrator";
   import {env} from "../src/config/env.js";
   import {db, pool} from "../src/db/index.js";

   export default async function setup() {
       const databaseName = new URL(env.DATABASE_URL).pathname.slice(1);

       if (env.NODE_ENV !== "test" || !databaseName.endsWith("_test")) {
           stop(`Testid ei jookse andmebaasi "${databaseName}" peal. Kontrolli .env.test faili.`);
       }

       try {
           await pool.query("SELECT 1");
       } catch {
           stop("Testandmebaas ei vasta. Käivita: docker compose up -d postgres-test");
       }

       await migrate(db, {migrationsFolder: "migrations"});
       await pool.end();
   }

   function stop(message: string): never {
       console.error(`\n${message}\n`);
       process.exit(1);
   }
   ```
   `console.error` + `process.exit` nagu `env.ts`-is: lisa `tests/global-setup.ts` `.oxlintrc.json` `no-console` erandite hulka.
6. `tests/setup.ts` (iga testifaili alguses):
   ```ts
   import {afterAll, beforeEach} from "vitest";
   import {pool} from "../src/db/index.js";

   beforeEach(async () => {
       const {rows} = await pool.query<{tablename: string}>(
           "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
       );
       const tables = rows.map((row) => `"${row.tablename}"`).join(", ");

       await pool.query(`TRUNCATE TABLE ${tables} CASCADE`);
   });

   afterAll(async () => {
       await pool.end();
   });
   ```
   Tabelite nimed loetakse andmebaasist: uus tabel tühjendatakse automaatselt ja seda ei saa unustada.
7. `src/auth/auth.ts`:
   ```ts
   import {testUtils} from "better-auth/plugins";
   // ...
   plugins: env.NODE_ENV === "test" ? [testUtils()] : [],
   ```
8. `tests/helpers/auth.ts`:
   ```ts
   import type {TestHelpers} from "better-auth/plugins";
   import {auth} from "../../src/auth/auth.js";
   import type {AuthUser} from "../../src/auth/express.js";

   export type Role = NonNullable<AuthUser["role"]>;

   export async function loginAs(role: Role) {
       const ctx = await auth.$context;
       const test = (ctx as unknown as {test: TestHelpers}).test;

       const user = await test.saveUser(
           test.createUser({
               email: `${role}-${crypto.randomUUID()}@test.ee`,
               role,
           }),
       );
       const {headers} = await test.login({userId: user.id});

       return {user, cookie: headers.get("cookie")!};
   }
   ```
   `as unknown as`: plugin on olemas ainult testirežiimis, seega TypeScript ei tea `ctx.test`-ist. Ütleme seda ühes kohas.
9. `tests/tsconfig.json` (testid laiendavad juur-`tsconfig`-it, aga ei lähe `dist`-i):
   ```json
   {
     "extends": "../tsconfig.json",
     "compilerOptions": {
       "rootDir": "..",
       "noEmit": true
     },
     "include": ["**/*", "../src/**/*", "../vitest.config.ts"]
   }
   ```
10. `package.json`:
    ```json
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit && tsc -p tests"
    ```
11. Esimesed testid. `tests/environment.test.ts`:
    ```ts
    import {describe, expect, it} from "vitest";
    import {env} from "../src/config/env.js";
    import {db} from "../src/db/index.js";
    import {eventSchema} from "../src/db/schema/event.schema.js";

    describe("testikeskkond", () => {
        it("kasutab testandmebaasi", () => {
            expect(env.NODE_ENV).toBe("test");
            expect(env.DATABASE_URL).toContain("/app_test");
        });

        it("migratsioonid on tehtud ja tabelid on tühjad", async () => {
            const events = await db.select().from(eventSchema);
            expect(events).toEqual([]);
        });
    });
    ```
    `tests/auth/me.routes.test.ts`:
    ```ts
    import request from "supertest";
    import {describe, expect, it} from "vitest";
    import app from "../../src/app.js";
    import {loginAs} from "../helpers/auth.js";

    describe("GET /api/me", () => {
        it("tagastab 401, kui kasutaja pole sisse loginud", async () => {
            const response = await request(app).get("/api/me");

            expect(response.status).toBe(401);
        });

        it("tagastab sisselogitud kasutaja koos rolliga", async () => {
            const {cookie, user} = await loginAs("organizer");

            const response = await request(app).get("/api/me").set("Cookie", cookie);

            expect(response.status).toBe(200);
            expect(response.body).toMatchObject({id: user.id, role: "organizer"});
        });
    });
    ```
    Muster igas testis: **valmista** (andmed, `loginAs`) → **tee** (üks päring) → **kontrolli** (`expect`).
12. Käivita: `npm test`. Proovi meelega katki teha (`"organizer"` → `"admin"` `expect`-is) ja vaata, mida Vitest ütleb.
13. Lisa PR malli kontrollnimekirja `- [ ] npm test on roheline` ja README-sse testide käivitamise juhend.

## Valmis, kui…

- [ ] `npm test` läbib 4 testi
- [ ] Testid ei puutu arendusbaasi (`.env.test` → port `5433`, `app_test`)
- [ ] `testUtils` plugin on ainult `NODE_ENV=test` korral
- [ ] `npm run typecheck` kontrollib ka teste
- [ ] PR mallis on testide rida

## Mida sa saavutasid

- **Nüüd töötab:** `npm test` töötab eraldi testandmebaasi peal ja testis saad sisse logida mis tahes rolliga.
- **Said selgeks:** Testid ei tohi puutuda arendusbaasi ja iga test alustab puhtalt lehelt.
- **Edasi:** Järgmises sammus kirjutad testid kõigele, mis ürituste moodulis juba olemas on.

## Kontrollküsimused

1. **Miks testidel on eraldi andmebaas?** Testid tühjendavad tabeleid iga testi eel.
2. **Miks `testUtils` ainult testirežiimis?** See loob sessiooni ükskõik kellele.
3. **Miks tabelid tühjendatakse iga testi eel?** Testid ei tohi sõltuda üksteisest ega järjekorrast.

## Materjalid

- [Vitest: Getting Started](https://vitest.dev/guide/)
- [supertest](https://github.com/ladjs/supertest)
- [Better Auth: Test utils](https://www.better-auth.com/docs/plugins/test-utils)
- [Node.js integration tests best practices](https://github.com/testjavascript/nodejs-integration-tests-best-practices)

## Sõltub

- #20
