---
title: 6. Keskkonnamuutujad ja nende kontroll (zod)
milestone: M0 – Projekti algus
labels: seadistus, suurus: S
---

## Eesmärk

Rakendus loeb seaded (port, andmebaasi aadress) keskkonnamuutujatest ja **ei käivitu**, kui mõni on puudu või vale. Viga on selge ja tuleb kohe, mitte keset päringut.

## Taust

- Seaded, mis erinevad arvutiti (port, andmebaasi parool), ei kuulu koodi. 🟢 Frontendis oli sama `VITE_API_URL`; backendis loeme `process.env`-ist.
- `process.env.X` on alati `string | undefined`. Kui kirjutad `Number(process.env.PORT)` ja muutuja puudub, saad `NaN` ja viga ilmneb kuskil täiesti mujal.
- **Zod** kirjeldab, milline andmekuju peab olema, ja kontrollib seda. Teeme kontrolli ÜHES kohas (`src/config/env.ts`), kogu ülejäänud kood impordib valmis `env` objekti, mille tüübid on õiged (`env.PORT` on `number`).
- `.coerce.number()` teisendab stringi arvuks (`"3000"` → `3000`), sest keskkonnamuutujad on alati stringid.
- Kontrolli ebaõnnestumisel kutsume `process.exit(1)`. See on **ainus koht**, kus `console.error` on lubatud (lint-reegel #3-st).

## Sammud

1. Paigalda: `npm install zod`
2. `src/config/env.ts`:
   ```ts
   import z from "zod";

   const envSchema = z.object({
       NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
       PORT: z.coerce.number().int().min(1024).max(65535).default(3000),
       DATABASE_URL: z.url(),
   });

   const parseEnv = () => {
       const result = envSchema.safeParse(process.env);
       if (!result.success) {
           console.error(`Invalid environment variable: ${z.prettifyError(result.error)}`);
           process.exit(1);
       }
       return result.data;
   };

   export const env = parseEnv();
   ```
   - `safeParse` ei viska viga, vaid tagastab `{success, data | error}`.
   - `z.prettifyError` teeb vea inimloetavaks.
3. `.env` ja `.env.example` (lisa vanade ridade juurde):
   ```
   PORT=3000
   NODE_ENV=development
   DATABASE_URL=postgres://app:sinu-parool@localhost:5432/events
   ```
   `.env.example`-isse samad read **ilma väärtusteta**. `DATABASE_URL`-i kasutaja, parool ja nimi peavad olema samad, mis `DATABASE_*` ridades.
4. `src/server.ts`: asenda `const PORT = 3000` impordiga:
   ```ts
   import {env} from "./config/env.js";
   // ...
   const server = app.listen(env.PORT, (error) => {
       if (error) throw error;
       console.log(`Server running at http://localhost:${env.PORT}`);
   });
   ```
5. Proovi:
   - `npm run server` töötab
   - kommenteeri `.env`-is `DATABASE_URL` välja: server peab kohe lõpetama selge veateatega
   - pane `PORT=80`: peab andma vea (min 1024)
6. Lisa README-sse lõik "Seadistus": kopeeri `.env.example` → `.env` ja täida.
7. Commit:
   ```bash
   git commit -am "feat: keskkonnamuutujate kontroll zodiga"
   ```

## Valmis, kui…

- [ ] Server loeb pordi `env.PORT`-ist
- [ ] Puuduv või vale `DATABASE_URL` peatab käivituse veateatega
- [ ] `.env.example` sisaldab kõiki muutujaid ilma väärtusteta
- [ ] `npm run lint` ei kurda `console.error` pärast (reegel on `env.ts` jaoks välja lülitatud)

## Mida sa saavutasid

- **Nüüd töötab:** Server ei käivitu, kui mõni seade on puudu või vale, ja ütleb kohe, mis viga on.
- **Said selgeks:** Keskkonnamuutujad hoiavad seadeid koodist eraldi ja zod kontrollib neid **käivitamisel**, mitte keset päringut.
- **Edasi:** Iga uus võti (Google, Stripe ...) lisatakse edaspidi `env.ts`-i ja `.env.example`-isse.

## Materjalid

- 📖 [M6 › Konfiguratsioon ja saladused](https://vikatgen.github.io/oppematerjalid/veebirakendused/backend/14-konfiguratsioon): keskkonnamuutujad, .env vs .env.example, 12 faktorit, kontroll käivitamisel
- [Zod: Basic usage](https://zod.dev/basics)
- [Node.js: --env-file](https://nodejs.org/api/cli.html#--env-fileconfig)
- [The Twelve-Factor App: Config](https://12factor.net/config)

## Sõltub

- #5
