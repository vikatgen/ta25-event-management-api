---
title: 35. Töödejärjekord (pg-boss) ja worker
milestone: M8 – Tühistamine
labels: api, suurus: L
---

## Eesmärk

Pileti tühistamine vastab **kohe** (`202 Accepted`) ja tagasimakse tehakse **taustal** eraldi protsessis (worker). Kui Stripe on maas, proovitakse automaatselt uuesti.

```
POST /api/tickets/:id/cancel → kontrollid → töö järjekorda → 202
worker: võtab töö → Stripe refund → TEHING (cancelled, sold - 1)
                 └─ viga → pg-boss proovib uuesti (10 s, 20 s, 40 s, ...)
```

## Taust

- **Miks järjekord?** #34-s ootas kasutaja Stripe'i vastust. Kui Stripe on aeglane või maas, saab kasutaja vea ja peab ise uuesti proovima. Ürituse tühistamisel (#36) oleks sadu tagasimakseid ühe päringu sees: see ei mahuks ühte HTTP päringusse.
- **pg-boss** on töödejärjekord **samas Postgresis** (eraldi skeem `pgboss`). Lisateenust (Redis, RabbitMQ) pole vaja. Töö on kirjas andmebaasis: serveri taaskäivitus seda ei kaota.
- **Server ainult PANEB töid järjekorda** (`send`). **Worker** (`npm run worker`) on eraldi protsess, mis võtab töid ja teeb need ära. Sama kood, aga HTTP-d seal pole. Neid saab eraldi käivitada ja skaleerida.
- **Töö andmetes on ainult id**, mitte terve pilet: töö võib joosta minutite pärast ja selleks ajaks võivad andmed olla muutunud. Handler loeb värske seisu ise andmebaasist.
- **Korduskindel handler:** sama töö võib joosta mitu korda (kordus pärast viga, topeltklõps → kaks tööd). Kui pilet pole enam `active`, on töö juba tehtud: lõpeta **vaikselt**. Viga visata ei tohi, muidu pg-boss kordaks igavesti.
- **`202 Accepted`:** "võtsin vastu, teen hiljem". Pilet muutub `cancelled`-iks, kui raha on tagastatud (vt `GET /api/orders/me`).
- **`JobQueue` klass:** service'id ei kutsu `boss.send` otse. Järjekorra nimi ja andmete kuju on ühes kohas ja testis saab selle võltsida.

## Sammud

1. Paigalda: `npm install pg-boss`
2. `src/jobs/queues.ts`:
   ```ts
   export const QUEUES = {
       refundTicket: "refund-ticket",
   } as const;

   export type RefundTicketJob = {ticketId: string};

   export const RETRY_OPTIONS = {
       retryLimit: 5,
       retryDelay: 10,
       retryBackoff: true,
   };
   ```
   `retryBackoff`: iga kord pikema vahega, et maas olevat teenust mitte üle koormata.
3. `src/jobs/boss.ts`:
   ```ts
   import {PgBoss} from "pg-boss";
   import {env} from "../config/env.js";
   import {QUEUES, RETRY_OPTIONS} from "./queues.js";

   export const boss = new PgBoss(env.DATABASE_URL);

   export async function startBoss(): Promise<void> {
       await boss.start();
       await boss.createQueue(QUEUES.refundTicket, RETRY_OPTIONS);
   }
   ```
   `start()` loob esimesel korral skeemi `pgboss`. `createQueue` on korduskindel.
4. `src/jobs/job.queue.ts`:
   ```ts
   import type {PgBoss} from "pg-boss";
   import {QUEUES, type RefundTicketJob} from "./queues.js";

   export class JobQueue {
       constructor(private readonly boss: PgBoss) {}

       async refundTicket(ticketId: string): Promise<void> {
           const data: RefundTicketJob = {ticketId};
           await this.boss.send(QUEUES.refundTicket, data);
       }
   }
   ```
5. `ticket.service.ts`: jaga `cancel` kaheks. Konstruktorisse `private readonly jobQueue: JobQueue`.
   ```ts
   async cancel(id: string, user: AuthUser): Promise<void> {
       const ticket = await this.findOwnedById(id, user);

       if (ticket.status !== "active") {
           throw new ConflictError("Tühistada saab ainult kehtivat piletit");
       }

       if (new Date() >= ticket.eventStartsAt) {
           throw new ConflictError("Üritus on juba alanud, piletit ei saa tühistada");
       }

       await this.jobQueue.refundTicket(ticket.id);
   }

   async refund(ticketId: string): Promise<void> {
       const ticket = await this.ticketRepository.findById(ticketId);

       if (!ticket || ticket.status !== "active") {
           return;
       }

       if (!ticket.stripePaymentIntentId) {
           throw new UnexpectedError("Makstud tellimusel puudub Stripe'i makse id");
       }

       await this.paymentGateway.refund(ticket.stripePaymentIntentId, ticket.priceCents, `refund-${ticket.id}`);

       await this.db.transaction(async (tx) => {
           const cancelled = await this.ticketRepository.cancel(ticket.id, tx);

           if (cancelled) {
               await this.ticketTypeRepository.release(ticket.eventId, ticket.ticketTypeId, 1, tx);
           }
       });
   }
   ```
   - Kontrollid jäävad `cancel`-i: kasutaja saab vea (`409`) kohe teada.
   - Stripe ja tehing liiguvad `refund`-i (#34 kood).
6. `ticket.controller.ts`: `await this.service.cancel(id, req.user!); res.status(StatusCode.ACCEPTED).end();` ja lisa `ACCEPTED: 202` `status-codes.ts`-i.
   `ticket.routes.ts`: `export const ticketService = new TicketService(db, ticketRepository, ticketTypeRepository, new PaymentGateway(stripe), new JobQueue(boss));`
7. `src/server.ts`: `await startBoss();` (pärast `SELECT 1`) ja `shutdown`-is enne `pool.end()`: `await boss.stop();`
8. `src/worker.ts`:
   ```ts
   import type {Job} from "pg-boss";
   import {pool} from "./db/index.js";
   import {boss, startBoss} from "./jobs/boss.js";
   import {QUEUES, type RefundTicketJob} from "./jobs/queues.js";
   import {ticketService} from "./ticket/ticket.routes.js";

   await startBoss();

   await boss.work<RefundTicketJob>(QUEUES.refundTicket, async (jobs: Job<RefundTicketJob>[]) => {
       for (const job of jobs) {
           await ticketService.refund(job.data.ticketId);
       }
   });

   // oxlint-disable-next-line no-console -- asendub logijaga (#44)
   console.log("Worker running");

   let isShuttingDown = false;

   async function shutdown() {
       if (isShuttingDown) return;
       isShuttingDown = true;

       setTimeout(() => process.exit(1), 35000).unref();

       await boss.stop();
       await pool.end();
       process.exit(0);
   }

   process.on("SIGINT", shutdown);
   process.on("SIGTERM", shutdown);
   ```
   - Handler saab massiivi (vaikimisi üks töö). Kui handler viskab vea, märgib pg-boss töö ebaõnnestunuks ja proovib hiljem uuesti.
   - `boss.stop()` ootab, kuni pooleli olevad tööd lõpevad. Seepärast on jõuga lõpetamise aeg pikem kui serveril.

   `package.json`: `"worker": "tsx --env-file=.env src/worker.ts"`
9. Testid. Workerit testides **ei käivitata**: test kontrollib, et töö pandi järjekorda, ja kutsub handleri ise.
   - `tests/setup.ts`: `beforeAll(startBoss)`, `beforeEach`-i `await pool.query("DELETE FROM pgboss.job");` (pg-bossi tööd on eraldi skeemis, `TRUNCATE` neid ei puuduta), `afterAll`-i enne `pool.end()`: `await boss.stop();`
   - `tests/helpers/jobs.ts`:
     ```ts
     import {pool} from "../../src/db/index.js";

     export async function queuedJobs<T>(queue: string): Promise<T[]> {
         const {rows} = await pool.query<{data: T}>("SELECT data FROM pgboss.job WHERE name = $1", [queue]);
         return rows.map((row) => row.data);
     }
     ```
   - `ticket.routes.test.ts` uuenda:
     - tühistamine → `202`, järjekorras on `{ticketId}` ja pilet on **esialgu endiselt `active`**
     - `ticketService.refund(id)` → Stripe kutsuti, pilet `cancelled`, `sold` vähenes
     - Stripe kukub → `refund` viskab vea, pilet jääb `active` (pg-boss kordab)
     - sama töö kaks korda samal ajal → `sold` vähenes **ühe** võrra. Kasuta aeglast Stripe'i võltsi (`mockImplementation` + `setTimeout(..., 50)`), muidu jõuaks esimene töö lõpuni enne, kui teine alustab
     - pilet juba tühistatud → Stripe'i ei kutsuta
10. **Proovi päriselt:** neli terminali (`server`, `worker`, `stripe:listen`, ost testkaardiga) → tühista pilet → vastus `202` → mõne sekundi pärast on `/api/orders/me`-s pilet `cancelled`. Peata worker, tühista teine pilet, käivita worker uuesti: töö tehakse ära.
11. Lisa README-sse `npm run worker` ja selgitus, et maksete proovimiseks peab see käima.

## Valmis, kui…

- [ ] Tühistamine vastab `202` ja tagasimakse teeb worker
- [ ] Peatatud worker ei kaota tööd: pärast käivitamist tehakse see ära
- [ ] Korduv töö ei tee teist tagasimakset ega vähenda `sold`-i teist korda
- [ ] Testid kontrollivad järjekorda ilma workerita

## Mida sa saavutasid

- **Nüüd töötab:** Tühistamine vastab kohe ja tagasimakse teeb taustal worker, kes Stripe'i rikke korral proovib uuesti.
- **Said selgeks:** Töödejärjekord: aeglane või ebakindel töö eraldatakse päringust. `202 Accepted` tähendab "võtsin vastu, teen ära".
- **Edasi:** Järgmises sammus kasutad järjekorda paljude piletite tagastamiseks korraga.

## Kontrollküsimused

1. **Miks töö andmetes on ainult id?** Töö võib joosta hiljem, handler peab lugema värske seisu.
2. **Miks juba tehtud töö lõpeb vaikselt, mitte veaga?** Viga paneks pg-bossi tööd kordama.
3. **Miks worker on eraldi protsess?** Seda saab eraldi käivitada ja skaleerida ning see ei aeglusta HTTP päringuid.

## Materjalid

- 📖 [M6 › Taustatööd ja järjekorrad](https://vikatgen.github.io/oppematerjalid/veebirakendused/backend/13-taustatood-ja-jarjekorrad): järjekord, worker, uuesti proovimine, fan-out, töö tehingus, idempotency key
- [pg-boss](https://github.com/timgit/pg-boss)
- [pg-boss: API](https://timgit.github.io/pg-boss/)
- [MDN: 202 Accepted](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/202)

## Sõltub

- #34
