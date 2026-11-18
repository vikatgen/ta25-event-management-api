---
title: 8. Better Auth: seadistus, rollid ja esimene migratsioon
milestone: M1 – Sisselogimine
labels: andmebaas, suurus: L
---

## Eesmärk

Better Auth on seadistatud, tema tabelid (`user`, `session`, `account`, `verification`) on andmebaasis ja Express suunab kõik `/api/auth/...` päringud talle. Igal kasutajal on roll. See on **esimene migratsioon**.

## Taust

> **Better Auth vastutab küsimuse "kes sa oled?" eest. Meie kood vastutab küsimuse "mida sa tohid teha?" eest.**

- Sisselogimine (OAuth voog, sessioonid, cookie'd, kasutajate salvestamine) on igas rakenduses sama. Seda pole mõtet ise kirjutada: meie aeg läheb piletitele.
- 🟢 Frontendis kutsusid `/api/auth/...` aadresse. Nüüd teeme need aadressid ise, õigemini laseme Better Authil teha.
- **Rollid kohe alguses:** `attendee` (vaikimisi), `organizer`, `security`, `admin`. Kõik hilisemad route'id vajavad rolle ja hiljem lisamine tähendaks lisamigratsiooni.
- **`uuid`, mitte `text` id-d:** Better Auth kasutab vaikimisi `text`. Meie tabelid (üritused, piletid) kasutavad `uuid`-i ja võõrvõti peab olema mõlemal pool sama tüüpi.
- **Skeemi ei kirjuta me käsitsi.** Better Authi CLI genereerib `src/db/schema/auth.ts` meie seadistuse põhjal. Seda faili ei muudeta käsitsi: järgmine genereerimine kirjutaks muudatused üle.

| Tabel | Mis see on |
|---|---|
| `user` | inimene: nimi, e-post, pilt, `role` |
| `account` | sisselogimisviis: `provider_id` = `"google"`, `account_id` = Google'i kasutaja id |
| `session` | sessioon: token (cookie's), aegumine, `user_id` |
| `verification` | ajutised tokenid (nt OAuth `state`) |

Ühel inimesel võib olla mitu `account` rida (Google ja GitHub).

## Sammud

1. Paigalda:
   ```bash
   npm install better-auth @better-auth/drizzle-adapter
   npm install -D --save-exact auth@<sama versioon mis better-auth>
   ```
   `auth` on Better Authi CLI. `--save-exact` kirjutab täpse versiooni, et kõigil tekiks sama skeem.
2. `.env` ja `.env.example`:
   ```
   BETTER_AUTH_SECRET=        # openssl rand -base64 48
   BETTER_AUTH_URL=http://localhost:3000
   ```
   `src/config/env.ts`, lisa `envSchema` sisse:
   ```ts
   BETTER_AUTH_SECRET: z.string().min(32),
   BETTER_AUTH_URL: z.url(),
   ```
   Saladusega allkirjastatakse sessioonid: kui see lekib, saab sisselogimisi võltsida.
3. `src/auth/roles.ts`:
   ```ts
   export const ROLES = ["attendee", "organizer", "security", "admin"] as const;

   export type Role = (typeof ROLES)[number];
   ```
   `as const`: TypeScript teab täpseid väärtusi (`"attendee" | "organizer" | ...`), mitte lihtsalt `string[]`.
4. `src/auth/auth.ts`:
   ```ts
   import {betterAuth} from "better-auth";
   import {drizzleAdapter} from "@better-auth/drizzle-adapter";
   import {db} from "../db/index.js";
   import {env} from "../config/env.js";
   import * as schema from "../db/schema/auth.js";
   import {ROLES} from "./roles.js";

   export const auth = betterAuth({
       baseURL: env.BETTER_AUTH_URL,
       secret: env.BETTER_AUTH_SECRET,
       database: drizzleAdapter(db, {provider: "pg", schema}),
       advanced: {
           database: {
               generateId: "uuid",
           },
       },
       user: {
           additionalFields: {
               role: {
                   type: [...ROLES],
                   required: false,
                   defaultValue: "attendee",
                   input: false,
               },
           },
       },
   });
   ```
   - `input: false`: **kasutaja ei saa oma rolli ise määrata.** Muidu võiks igaüks end adminiks teha.
   - ⚠️ `import * as schema` annab vea, kuni skeem pole genereeritud (samm 6). See on ootuspärane.
5. `package.json` skript:
   ```json
   "auth:generate": "auth generate --config src/auth/auth.ts --output src/db/schema/auth.ts"
   ```
   Lisa `src/db/schema/auth.ts` faili `.prettierignore`-i: genereeritud faili ei vorminda.
6. Genereeri skeem ja migratsioon:
   ```bash
   npm run auth:generate
   npm run db:generate -- --name=create_auth_tables
   ```
   **Loe SQL fail läbi** (`migrations/<aeg>_create_auth_tables.sql`): kas `id` veerud on `uuid`? Kas `user` tabelis on `role`? Seejärel:
   ```bash
   npm run db:migrate
   ```
7. `src/app.ts`:
   ```ts
   import express from "express";
   import {toNodeHandler} from "better-auth/node";
   import {auth} from "./auth/auth.js";

   const app = express();

   app.all("/api/auth/*splat", toNodeHandler(auth));

   app.use(express.json());

   export default app;
   ```
   - `*splat` on Express 5 süntaks "kõik, mis tuleb pärast `/api/auth/`".
   - **Better Auth peab olema ENNE `express.json()`-it.** Päringu keha saab lugeda ainult üks kord: kui `express.json()` loeb selle enne, jääb Better Auth tühja kätega.
8. Kontrolli:
   ```bash
   npm run typecheck
   npm run server
   curl localhost:3000/api/auth/ok      # {"ok":true}
   npm run db:studio                    # 4 tabelit
   ```
   Viga `Drizzle schema mismatch ... Missing tables` tähendab, et migratsioon on tegemata.
9. Lisa README-sse `auth:generate` ja märkus: kui `auth.ts` seadistus muutub, korda `auth:generate` → `db:generate` → `db:migrate`.

## Valmis, kui…

- [ ] `curl localhost:3000/api/auth/ok` vastab `{"ok":true}`
- [ ] Studios on 4 tabelit, `user` tabelis on `role` veerg ja `id` on `uuid`
- [ ] `migrations/` kaustas on esimene SQL fail ja see on commit'is
- [ ] `src/db/schema/auth.ts` on genereeritud, mitte käsitsi kirjutatud

## Mida sa saavutasid

- **Nüüd töötab:** Andmebaasis on kasutajate, sessioonide ja kontode tabelid ning igal kasutajal on roll.
- **Said selgeks:** Esimene migratsioon: skeem koodis → SQL fail → tabel andmebaasis. Autentimise teek teeb ära töö, mida ise kirjutada oleks ohtlik.
- **Edasi:** Järgmises sammus saab päris inimene Google'iga sisse logida.

## Kontrollküsimused

1. **Miks `input: false` rollil?** Muidu saaks kasutaja registreerimisel saata `role: "admin"`.
2. **Miks peab Better Auth olema enne `express.json()`-it?** Keha saab lugeda üks kord.
3. **Mis vahe on `user` ja `account` tabelil?** `user` = inimene, `account` = viis, kuidas ta sisse logib.

## Materjalid

- 📖 [M6 › ORM ja migratsioonid](https://vikatgen.github.io/oppematerjalid/veebirakendused/backend/06-orm-ja-migratsioonid): mida ORM teeb, migratsioon kui andmebaasi versioonihaldus, miks vana migratsiooni ei muudeta
- 📖 [M6 › Autentimine ja autoriseerimine](https://vikatgen.github.io/oppematerjalid/veebirakendused/backend/08-autentimine-ja-autoriseerimine): kes sa oled vs mida sa tohid, roll vs omanik, 401 vs 403 vs 404
- 📖 [M6 › Küpsised, sessioonid ja tokenid](https://vikatgen.github.io/oppematerjalid/veebirakendused/backend/09-sessioonid-ja-tokenid): küpsise atribuudid, sessioon andmebaasis vs JWT, väljalogimine
- [Better Auth: Installation](https://www.better-auth.com/docs/installation)
- [Better Auth: Drizzle adapter](https://www.better-auth.com/docs/adapters/drizzle)
- [Better Auth: Express integration](https://www.better-auth.com/docs/integrations/express)

## Sõltub

- #7
