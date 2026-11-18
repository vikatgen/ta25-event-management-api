---
title: 1. Node.js + TypeScript + Express projekti loomine
milestone: M0 – Projekti algus
labels: seadistus, suurus: M
---

## Eesmärk

TypeScriptis kirjutatud Express server käivitub käsuga `npm run server` ja sulgub korralikult `Ctrl+C`-ga. Sellest kasvab kogu piletirakenduse backend.

## Taust

- **TypeScript** püüab vead kinni enne käivitamist (vale välja nimi, puuduv argument). 🟢 Frontendis kasutasid sama: siin lihtsalt serveri poolel.
- **Express** on Node.js veebiraamistik. 🟢 Vue maailmas on lähim paralleel Nuxti server (`server/api`), aga Express on palju "paljam": route'id ja vahevara (middleware) paned ise kokku.
- **`app.ts` ja `server.ts` eraldi:** `app.ts` kirjeldab rakendust (route'id, middleware'id), `server.ts` käivitab selle pordil. Testid saavad hiljem kasutada `app`-i ilma serverit käivitamata.
- **`tsx`** käivitab `.ts` faile otse, ilma eraldi kompileerimiseta. Tootmises kompileerime `tsc`-ga `dist/` kausta ja käivitame tavalise `node`-iga.

## Sammud

1. Kontrolli Node.js versiooni (vaja 22+):
   ```bash
   node -v
   ```
2. Loo projekt ja paigalda paketid:
   ```bash
   npm init -y
   npm install express
   npm install -D typescript tsx @types/node @types/express
   ```
   `express` on vajalik ka tootmises (`dependencies`). Ülejäänud on ainult arenduseks (`-D` = `devDependencies`).
3. `package.json`: lisa `"type": "module"` (kasutame `import`/`export`, mitte `require`) ja skriptid:
   ```json
   "type": "module",
   "scripts": {
     "server": "tsx --env-file=.env src/server.ts",
     "build": "tsc",
     "start": "node dist/server.js",
     "typecheck": "tsc --noEmit"
   }
   ```
   - `--env-file=.env` laeb `.env` faili (Node'i sisseehitatud võimalus). Loo praegu tühi fail: `touch .env`.
   - `build` + `start` on tootmiseks: `tsc` teeb `src/` → `dist/`.
4. `tsconfig.json`:
   ```json
   {
     "compilerOptions": {
       "rootDir": "./src",
       "outDir": "./dist",
       "module": "nodenext",
       "target": "esnext",
       "types": ["node", "express"],
       "sourceMap": true,
       "strict": true,
       "verbatimModuleSyntax": true,
       "isolatedModules": true,
       "noUncheckedSideEffectImports": true,
       "moduleDetection": "force",
       "skipLibCheck": true
     },
     "include": ["src/**/*"],
     "exclude": ["node_modules", "dist"]
   }
   ```
   - `module: nodenext` on Node'i moodulisüsteem. **Selle tõttu kirjutame importides `.js`** (vt samm 6).
   - `strict: true` lülitab sisse kõik põhilised kontrollid.
5. `.gitignore`:
   ```
   node_modules
   dist
   .idea
   .env
   ```
6. `src/app.ts`:
   ```ts
   import express from "express";

   const app = express();

   export default app;
   ```
7. `src/server.ts`:
   ```ts
   import app from "./app.js";

   const PORT = 3000;

   const server = app.listen(PORT, (error) => {
       if (error) throw error;
       console.log(`Server running at http://localhost:${PORT}`);
   });

   let isShuttingDown = false;

   async function shutdown(signal: string) {
       if (isShuttingDown) return;
       isShuttingDown = true;
       console.log(`${signal} received, shutting down...`);

       setTimeout(() => process.exit(1), 8000).unref();

       await new Promise((resolve) => server.close(resolve));
       process.exit(0);
   }

   process.on("SIGINT", shutdown);
   process.on("SIGTERM", shutdown);
   ```
   - `import app from "./app.js"`: fail on `app.ts`, aga kirjutame `.js`, sest TypeScript importe ei muuda ja käivitamisel on failid juba `.js`.
   - `SIGINT` = `Ctrl+C`, `SIGTERM` = süsteem (Docker, PM2) palub sulguda.
   - `isShuttingDown`: kaks korda `Ctrl+C` ei alusta sulgemist uuesti.
   - `server.close(...)` lõpetab uute päringute vastuvõtmise ja ootab, kuni pooleli olevad lõpevad.
   - `setTimeout(..., 8000).unref()`: kui sulgemine jääb kinni, lõpetame 8 s pärast jõuga. `.unref()` tähendab, et see taimer ise ei hoia programmi elus.
8. Kontrolli:
   ```bash
   npm run typecheck
   npm run server
   ```
   Ava http://localhost:3000. Express vastab "Cannot GET /": see on õige, sest route'e veel pole. Vajuta `Ctrl+C` ja vaata sulgemise teadet.
9. Esimene commit:
   ```bash
   git add .
   git commit -m "chore: express ja typescript projekt"
   ```

## Valmis, kui…

- [ ] `npm run typecheck` lõpeb vigadeta
- [ ] `npm run server` käivitab serveri ja brauser näitab "Cannot GET /"
- [ ] `Ctrl+C` sulgeb serveri teatega
- [ ] `npm run build` loob `dist/server.js`
- [ ] Esimene commit on tehtud

## Mida sa saavutasid

- **Nüüd töötab:** Sul on TypeScriptis Express server, mis käivitub ühe käsuga ja sulgub korralikult.
- **Said selgeks:** Mis vahe on `app.ts`-il (rakenduse kirjeldus) ja `server.ts`-il (käivitamine), miks importides on `.js` ja mis on `SIGINT`/`SIGTERM`.
- **Edasi:** See on kogu rakenduse vundament: iga järgmine samm lisab `app.ts`-i midagi juurde.

## Materjalid

- 📖 [M6 › Päringu ja vastuse tsükkel](https://vikatgen.github.io/oppematerjalid/veebirakendused/backend/01-paringu-ja-vastuse-tsukkel): päring, vastus, staatusekoodid, miks server ei mäleta eelmist päringut
- [Express: Hello world](https://expressjs.com/en/starter/hello-world.html)
- [TypeScript: tsconfig reference](https://www.typescriptlang.org/tsconfig)
- [Node.js: process signals](https://nodejs.org/api/process.html#signal-events)
