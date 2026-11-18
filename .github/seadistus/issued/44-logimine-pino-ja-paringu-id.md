---
title: 44. Logimine (pino) ja päringu id
milestone: M10 – Kvaliteet
labels: seadistus, suurus: L
---

## Eesmärk

Server ja worker logivad struktureeritult (JSON): iga päring, olulised äri- ja turvasündmused ning workeri tööd. Igal päringul on id (`X-Request-Id`), millega leiab logist kõik selle päringu read. `console.log`-i rakenduse koodis enam pole.

## Taust

- **`console.log("Tellimus loodud " + id)`** on tekst. Seda on raske otsida ja filtreerida. **Struktureeritud logi** on JSON: `{"level":"info","module":"order","orderId":"...","msg":"Tellimus loodud"}`. Selle järgi saab otsida (`orderId = ...`).
- **Üks rida = üks sündmus**, andmed objektina, mitte teksti sees: `log.info({orderId}, "Tellimus loodud")`.
- **pino**, mitte winston: kiirem, JSON vaikimisi, vähem seadistust. Arenduses teeb `pino-pretty` sellest loetava rea.
- **Päringu id:** igal päringul on id, mis on vastuse päises `X-Request-Id` ja igal logireal. Kasutaja saab selle edastada ("viga, id abc-123") ja sellega leiab logist kõik read.
- **Mida logida:** raha liikumine, olekumuutused, turvasündmused. **Mida mitte:** cookie'd, võtmed, pileti `code` (sellega saaks uksest sisse). `redact` peidab need päised automaatselt.
- **Moodulite logijad** (`logger.child({module: "order"})`): igal real on moodul, selle järgi saab filtreerida. Logija on nagu `console`: seda ei anta konstruktoris (DI) ega võltsita testides. Testides on tase `silent`.
- `env.ts` ja käsurea skriptid jäävad `console`-iga: `env.ts` peab töötama enne logijat ja skriptide väljund on inimesele (#3 lint-erand).

## Sammud

1. Paigalda:
   ```bash
   npm install pino pino-http
   npm install -D pino-pretty
   ```
2. `env.ts`: `LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info")`. `.env.example`: `LOG_LEVEL=`. `.env.test`: `LOG_LEVEL=silent`.
3. `src/shared/logging/logger.ts`:
   ```ts
   import {pino} from "pino";
   import {env} from "../../config/env.js";

   export const logger = pino({
       level: env.LOG_LEVEL,
       redact: {
           paths: [
               "req.headers.cookie",
               "req.headers.authorization",
               'req.headers["stripe-signature"]',
               'res.headers["set-cookie"]',
           ],
           censor: "[peidetud]",
       },
       ...(env.NODE_ENV === "development" && {
           transport: {
               target: "pino-pretty",
               options: {colorize: true, singleLine: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname"},
           },
       }),
   });
   ```
   Tootmises JSON (logiteenus loeb), arenduses loetav rida.
4. `src/shared/logging/request-logger.middleware.ts`:
   ```ts
   import type {IncomingMessage} from "node:http";
   import {pinoHttp} from "pino-http";
   import {logger} from "./logger.js";

   const fullUrl = (req: IncomingMessage) => (req as {originalUrl?: string}).originalUrl ?? req.url;

   export const requestLogger = pinoHttp({
       logger,
       genReqId: (req, res) => {
           const incoming = req.headers["x-request-id"];
           const id = typeof incoming === "string" && incoming.length <= 100 ? incoming : crypto.randomUUID();
           res.setHeader("X-Request-Id", id);
           return id;
       },
       autoLogging: {ignore: (req) => !fullUrl(req)?.startsWith("/api")},
       customLogLevel: (_req, res, err) => {
           if (err || res.statusCode >= 500) return "error";
           if (res.statusCode >= 400) return "warn";
           return "info";
       },
       customSuccessMessage: (req, res) => `${req.method} ${fullUrl(req)} ${res.statusCode}`,
       customErrorMessage: (req, res) => `${req.method} ${fullUrl(req)} ${res.statusCode}`,
       customProps: (req) => ({userId: (req as {user?: {id: string}}).user?.id}),
       serializers: {
           req: (req) => ({id: req.id}),
           res: (res) => ({statusCode: res.statusCode}),
       },
   });
   ```
   - Kui päringuga tuleb `X-Request-Id` (nt proxy'lt), kasutame seda. Pikkuse piir: keegi ei saa logi prügiga täita.
   - Staatilisi faile ei logita, ainult `/api`.
   - `serializers`: logisse ainult id ja staatus, mitte kõik päised.
5. `src/app.ts`, **esimesena** (enne `helmet`-it): `app.use(requestLogger);`. Nii jõuab logisse ka päring, mille piirang tagasi lükkab.
6. `error.middleware.ts`: asenda `console.error(err)` (koos lint-erandiga):
   ```ts
   req.log.error({err}, "Ootamatu viga");
   ```
   `req.log` on päringu logija: real on päringu id ja kasutaja.
7. `server.ts`: `console.log` → `logger.info(...)`, `shutdown`-is `logger.info({signal}, "Shutting down...")`.
8. `worker.ts`: iga töö algus, lõpp ja viga:
   ```ts
   async function runJobs<T extends object>(queue: string, jobs: Job<T>[], handler: (data: T) => Promise<void>) {
       for (const job of jobs) {
           const log = logger.child({queue, jobId: job.id, retryCount: job.retryCount, ...job.data});
           log.info("Töö algas");

           try {
               await handler(job.data);
               log.info("Töö lõppes");
           } catch (err) {
               log.error({err}, "Töö kukkus, pg-boss proovib uuesti");
               throw err;
           }
       }
   }

   await boss.work<RefundTicketJob>(QUEUES.refundTicket, (jobs) =>
       runJobs(QUEUES.refundTicket, jobs, (data) => ticketService.refund(data.ticketId)),
   );
   ```
   `boss.ts`: `boss.on("error", (err) => logger.error({err}, "pg-boss viga"));`
   Eemalda workerist `console.log` lint-erand.
9. **Äri- ja turvasündmused.** Igas service'is mooduli logija:
   ```ts
   const log = logger.child({module: "order"});
   ```
   | Moodul | Sündmus | Tase |
   |---|---|---|
   | order | tellimus loodud (`orderId`, `userId`, `totalCents`) | info |
   | order | makstud, aegus (`orderId`) | info |
   | order | makseleht kukkus, broneering vabastati | error |
   | order | makse tuli pärast ürituse tühistamist | warn |
   | payment | webhook vale allkirjaga | warn |
   | ticket | tühistamine järjekorras, raha tagastatud (`ticketId`, `amountCents`) | info |
   | event | üritus tühistatud, tagasimaksed järjekorras | info |
   | user | roll muudetud (`userId`, `role`, `changedBy`) | info |
   | event-staff | turvamees lisatud/eemaldatud | info |
   | scan | pilet skänniti / ei läinud läbi (`reason`) | info / warn |

   **Ära logi** pileti `code`-i, cookie'sid ega võtmeid.
10. Lint: `no-console` on nüüd kõikjal viga, peale `env.ts`, `src/scripts/**` ja `tests/global-setup.ts`. Kontrolli, et ühtegi teist erandit pole jäänud: `npm run lint`.
11. Testid `security.test.ts` (või eraldi fail): vastuses on `x-request-id`; saadetud `X-Request-Id: minu-id` tuleb vastuses tagasi.
12. **Proovi:** `npm run server`, tee ost ja vaata terminali: päringu rida + `module: "order"` rida sama päringu kohta. `LOG_LEVEL=debug npm run server` näitab rohkem.

## Valmis, kui…

- [ ] Iga `/api` päring logitakse koos staatuse, aja ja päringu id-ga
- [ ] Vastuses on `X-Request-Id`
- [ ] Raha liikumine, olekumuutused ja turvasündmused on logis koos id-dega
- [ ] Cookie'd, võtmed ja pileti koodid logisse ei jõua
- [ ] Rakenduse koodis pole `console.*` kutseid (peale lubatud erandite)

## Mida sa saavutasid

- **Nüüd töötab:** Server ja worker logivad struktureeritult ja iga päringu kõik read leiab päringu id järgi.
- **Said selgeks:** Mida logida (raha, olekumuutused, turvasündmused) ja mida **mitte** (cookie'd, võtmed, pileti koodid).
- **Edasi:** Kui midagi läheb katki, näed nüüd logist, mis juhtus.

## Kontrollküsimused

1. **Miks JSON, mitte tekst?** Selle järgi saab otsida ja filtreerida.
2. **Milleks päringu id?** Sellega leiab ühe päringu kõik read ja kasutaja saab selle edastada.
3. **Miks pileti `code`-i ei logita?** Sellega saaks uksest sisse.

## Materjalid

- [pino](https://getpino.io/)
- [pino-http](https://github.com/pinojs/pino-http)
- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)

## Sõltub

- #43
