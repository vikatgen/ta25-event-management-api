---
title: 48. Lõpukontroll: README, kaetuse lävend ja deploy (PM2)
milestone: M10 – Kvaliteet
labels: seadistus, suurus: M
---

## Eesmärk

Projekt on üleandmiseks valmis: README kirjeldab kõike, mida uus arendaja vajab, testide kaetusel on lävend (CI kukub, kui see langeb), sõltuvustes pole teadaolevaid haavatavusi ja rakenduse saab kooliserverisse panna (PM2).

## Taust

- **README on projekti uks.** Kes repo avab, peab ainult README järgi saama rakenduse käima: mis vaja paigaldada, millised keskkonnamuutujad, millised käsud.
- **Kaetuse lävend:** #23-s vaatasime aruannet. Nüüd, kui kõik moodulid on olemas, paneme alampiiri: kui keegi lisab testimata koodi ja kaetus langeb alla piiri, kukub `test:coverage` ja seega CI (#47). Lävi on **praegune tase**, mitte suvaline number: eesmärk on, et see ei langeks.
- **Mis kaetusest välja jääb:** `server.ts`, `worker.ts` (sisenemispunktid, testides ei käivitata) ja `src/scripts/` (käsurea skriptid).
- **`npm audit`** näitab teadaolevaid haavatavusi sõltuvustes.
- **Deploy:** kooliserveris Dockerit ei saa kasutada, seal on **PM2** (protsessihaldur: käivitab, taaskäivitab kukkumisel, hoiab logisid). Docker Compose jääb ainult arenduse Postgresi jaoks.

## Sammud

1. **Kaetuse lävend.** `npm run test:coverage` ja vaata kokkuvõtte rida (`All files`). `vitest.config.ts`:
   ```ts
   coverage: {
       provider: "v8",
       include: ["src/**/*.ts"],
       exclude: ["src/server.ts", "src/worker.ts", "src/scripts/**"],
       reporter: ["text", "html"],
       thresholds: {
           lines: 90,
           branches: 85,
           functions: 90,
           statements: 90,
       },
   },
   ```
   Pane numbrid oma tegeliku taseme järgi (ümardatult alla). Kui mõni fail on oluliselt alla, kirjuta enne puuduvad testid (aruandes punased read).
2. **Turvalisus:**
   ```bash
   npm audit
   npm audit fix
   ```
   Kui `audit fix` ei saa parandada (major versioon), otsusta: kas haavatavus puudutab meie kasutust? Kirjuta otsus README-sse.
3. **PM2 seadistus** `ecosystem.config.cjs` (`.cjs`, sest `package.json`-is on `"type": "module"`):
   ```js
   module.exports = {
       apps: [
           {
               name: "piletid",
               script: "dist/server.js",
               node_args: "--env-file=.env",
               kill_timeout: 10000,
           },
           {
               name: "piletid-worker",
               script: "dist/worker.js",
               node_args: "--env-file=.env",
               kill_timeout: 40000,
           },
       ],
   };
   ```
   - `kill_timeout`: PM2 ootab vaikimisi 1,6 s. Meie server vajab sulgemiseks kuni 8 s (#1), worker kuni 35 s (#35).
   - Worker on eraldi protsess: ilma selleta tagasimakseid ei tehta.
4. **Deploy käsud** (README-sse):
   ```bash
   git pull
   npm ci
   npm run build
   npm run db:migrate
   pm2 startOrReload ecosystem.config.cjs
   ```
   - `npm ci` **koos** devDependency'tega: `tsc` ja `drizzle-kit` on vaja ehitamiseks ja migratsioonideks.
   - Migratsioonid **enne** reload'i, eraldi sammuna.
   - Tootmise `.env`: `NODE_ENV=production`, päris `BETTER_AUTH_URL` ja `FRONTEND_URL`, Google'i/GitHubi callback'id päris aadressiga, Stripe'i võtmed ja webhook Stripe Dashboardis (mitte `stripe listen`).
5. **README lõplik kuju:**
   - mis rakendus see on (2–3 lauset), CI märk (#47)
   - **Tehnoloogiad** (tabel: Express, Drizzle, Better Auth, Stripe, pg-boss, pino, Vitest)
   - **Käivitamine** samm-sammult: Node (`.nvmrc`), Docker, `.env` (kopeeri `.env.example`), Google/GitHub OAuth, Stripe CLI, `db:migrate`, `seed`, `server`, `worker`
   - **Keskkonnamuutujad** (tabel: nimi → mis see on → kust saada)
   - **Käsud** (kõik `package.json` skriptid)
   - **Arhitektuur:** kaustastruktuur (#2), kihid (routes → controller → service → repository), moodulite seosed
   - **Läbimängimine** (#45)
   - **Testid** ja **Deploy**
   - **API dokumentatsioon:** `/api/docs`
6. Lõpukontroll puhtast olekust (nagu uus arendaja):
   ```bash
   git clone <repo> proov && cd proov
   cp .env.example .env   # täida
   npm ci && docker compose up -d && npm run db:migrate && npm run seed && npm run server
   ```
   Kas README järgi läks kõik ilma küsimata?

## Valmis, kui…

- [ ] `test:coverage` kukub, kui kaetus langeb alla lävendi
- [ ] `npm audit` on puhas või otsused on README-s kirjas
- [ ] `ecosystem.config.cjs` käivitab serveri ja workeri
- [ ] README järgi saab rakenduse puhtast kloonist käima
- [ ] Kõik eelnevad issued on suletud

## Mida sa saavutasid

- **Nüüd töötab:** Projekt on üleandmiseks valmis: README, kaetuse lävend, turvaaudit ja serverisse panemine PM2-ga.
- **Said selgeks:** Mida vajab inimene, kes sinu koodi esimest korda näeb, ja kuidas rakendus tootmises elab (server + worker).
- **Edasi:** **Sa ehitasid nullist päris backend'i:** sisselogimine, maksed, tagastused, taustatööd, testid ja CI. Vaata ülevaate issue linnukesed üle ja mõtle, mis oli kõige raskem.

## Kontrollküsimused

1. **Miks lävend on praegune tase, mitte 100%?** Eesmärk on, et kaetus ei langeks. 100% sunniks testima ka asju, mis kindlust ei lisa.
2. **Miks migratsioonid jooksutatakse enne reload'i?** Uus kood eeldab uut skeemi.
3. **Miks worker on PM2-s eraldi protsess?** Ilma selleta jäävad järjekorra tööd tegemata.

## Materjalid

- [Vitest: Coverage thresholds](https://vitest.dev/config/#coverage-thresholds)
- [npm audit](https://docs.npmjs.com/cli/commands/npm-audit)
- [PM2: Ecosystem file](https://pm2.keymetrics.io/docs/usage/application-declaration/)
- [Make a README](https://www.makeareadme.com/)
- [The Twelve-Factor App](https://12factor.net/)

## Sõltub

- #47
