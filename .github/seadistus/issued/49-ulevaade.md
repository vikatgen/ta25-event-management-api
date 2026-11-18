---
title: 📍 Ülevaade: rakenduse ehitamise teekond
milestone: 
labels: documentation
pinned: true
---

Piletirakenduse backend (Node.js + Express + TypeScript), mis ehitatakse samm-sammult. Iga issue on üks samm: **eesmärk → taust → sammud → valmis, kui… → mida sa saavutasid → kontrollküsimused → materjalid → sõltub**. Tee need järjekorras, sest hilisemad sammud kasutavad varasemate koodi.

**API dokumentatsioon** (pärast 43. sammu): http://localhost:3000/api/docs

> Märgi samm siin tehtuks, kui oled selle lõpetanud. Issue lingi kõrval näed, kas see on suletud.

## Rakendus

Korraldajad loovad üritusi ja piletitüüpe (tavaline, VIP). Inimesed ostavad pileteid Stripe'i kaudu, saavad QR-koodi ja võivad pileti tühistada (raha tagasi). Turvamees skännib uksel pileteid. Admin haldab rolle. Sisselogimine käib Google'i või GitHubiga.

## Tööriistad

| Vajadus | Teek | 🟢 Frontendis / Vue maailmas |
|---|---|---|
| Server | Express 5 + TypeScript (`tsx`) | Vite arendusserver |
| Andmebaas | PostgreSQL (Docker) + Drizzle ORM | – (andmed tulid API-st) |
| Valideerimine | zod | zod / vormi valideerimine |
| Sisselogimine | Better Auth (Google, GitHub) | `useMe`, sisselogimise nupp |
| Maksed | Stripe Checkout + webhook | suunamine `checkoutUrl`-ile |
| Taustatööd | pg-boss + worker | – |
| Logid | pino | `console` |
| Dokumentatsioon | OpenAPI (zod-to-openapi) + Scalar | `gen:api` tüübid sellest |
| Testid | Vitest + supertest + testandmebaas | Vitest + Testing Library |
| Stiil | Prettier + oxlint | sama |

## Töövoog

issue → haru `feat/<nr>-nimi` → commit'id → pull request (`Closes #<nr>`) → CI roheline → merge (vt samm 4)

## Teekond

### M0 – Projekti algus
- [ ] #1
- [ ] #2
- [ ] #3
- [ ] #4
- [ ] #5
- [ ] #6
- [ ] #7

### M1 – Sisselogimine
- [ ] #8
- [ ] #9
- [ ] #10
- [ ] #11

### M2 – Vead
- [ ] #12

### M3 – Üritused
- [ ] #13
- [ ] #14
- [ ] #15
- [ ] #16
- [ ] #17
- [ ] #18
- [ ] #19
- [ ] #20

### M4 – Testid
- [ ] #21
- [ ] #22
- [ ] #23

### M5 – Piletitüübid
- [ ] #24
- [ ] #25
- [ ] #26

### M6 – Tellimused
- [ ] #27
- [ ] #28
- [ ] #29
- [ ] #30

### M7 – Stripe
- [ ] #31
- [ ] #32
- [ ] #33

### M8 – Tühistamine
- [ ] #34
- [ ] #35
- [ ] #36

### M9 – Uks ja admin
- [ ] #37
- [ ] #38
- [ ] #39
- [ ] #40

### M10 – Kvaliteet
- [ ] #41
- [ ] #42
- [ ] #43
- [ ] #44
- [ ] #45
- [ ] #46
- [ ] #47
- [ ] #48

## Andmebaas kasvab samm-sammult

Iga tabel sünnib sammus, kus seda esimest korda vaja läheb. Võõrvõti saab viidata ainult juba olemasolevale tabelile.

| Migratsioon | Samm | Mis |
|---|---|---|
| 1 | 8 | Better Authi tabelid (`user` koos `role`-iga, `session`, `account`, `verification`) |
| 2 | 13 | `events` + `event_status` enum |
| 3 | 24 | `ticket_types` + check-piirangud |
| 4 | 27 | `orders` + `tickets` + olekute enumid |
| 5 | 32 | `orders.stripe_payment_intent_id` |
| 6 | 33 | osaline unikaalne indeks "üks ootel tellimus" |
| 7 | 38 | `event_staff` (liitvõti) |
| 8 | 40 | `tickets.used_at`, `tickets.scanned_by` |

```
user ──< events ──< ticket_types
  │        │             │
  │        ├──< orders ──┤
  │        │      └──< tickets
  └──< event_staff >──┘
```

## Seeder kasvab samm-sammult

| Samm | Lisandub |
|---|---|
| 20 | `npm run seed -- [email]`: kasutajad kõigis rollides, üritused kõigis olekutes, päris kasutaja adminiks |
| 26 | piletitüübid (Tavapilet, VIP) |
| 30 | makstud, ootel ja aegunud tellimused, välja müüdud VIP |
| 32 | makstud tellimustele näiv Stripe'i makse id |
| 38 | turvamees kahel üritusel |
| 40 | kasutatud ja kehtiv pilet tänasel üritusel |
| 45 | tühistatud pilet, tühistatud ürituse tagastatud piletid, kooskõla kontroll, läbimängimise juhend |
| 46 | `npm run seed:events`: 10 000 üritust jõudluse proovimiseks |

## Kaetus: kus mis fail tehakse

Iga fail valmis rakenduses kuulub vähemalt ühe sammu alla. Esimene number on samm, kus fail luuakse. Järgmised on sammud, kus seda täiendatakse.

### Juurkaust

| Fail | Sammud |
|---|---|
| `package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore` | 1, 2, 3 (ja iga paketi/skripti lisamisel) |
| `.prettierrc.json`, `.prettierignore`, `.oxlintrc.json`, `.editorconfig`, `.nvmrc` | 3 |
| `.github/pull_request_template.md` | 4, 21, 47 |
| `docker-compose.yaml` | 5, 21 |
| `.env.example` | 5, 6, 8, 9, 10, 31, 32, 44 |
| `drizzle.config.ts` | 7 |
| `.env.test`, `vitest.config.ts` | 21, 23, 48 (`.env.test` ka 31, 32, 44) |
| `migrations/*` | 8, 13, 24, 27, 32, 33, 38, 40 |
| `.github/workflows/ci.yml` | 47 |
| `ecosystem.config.cjs` | 48 |
| `README.md` | 2 ja iga samm, mis lisab käsu; 45, 48 |

### `src/`

| Fail | Sammud |
|---|---|
| `app.ts` | 1, 8, 9, 11, 12, 16, 19, 25, 26, 28, 32, 34, 37, 38, 40, 41, 43, 44 |
| `server.ts` | 1, 6, 7, 35, 44 |
| `worker.ts` | 35, 36, 44 |
| `config/env.ts` | 6, 8, 9, 10, 31, 32, 44 |
| `db/index.ts` | 7, 15, 28 |
| `db/columns.helpers.ts` | 13 |
| `db/schema/auth.ts` (genereeritud) | 8 |
| `db/schema/event.schema.ts` | 13 |
| `db/schema/ticket-type.schema.ts` | 24 |
| `db/schema/order.schema.ts` | 27, 32, 33, 40 |
| `db/schema/event-staff.schema.ts` | 38 |
| `auth/auth.ts` | 8, 9, 10, 21, 41 |
| `auth/roles.ts` | 8 |
| `auth/express.d.ts`, `auth/require-auth.middleware.ts`, `auth/me.routes.ts` | 11 |
| `auth/dto/me-response.dto.ts` | 11, 43 |
| `shared/http/status-codes.ts` | 12, 35, 41 |
| `shared/http/error.middleware.ts` | 12, 33, 41, 44 |
| `shared/errors/http.errors.ts`, `shared/errors/unexpected.error.ts` | 12 |
| `shared/validation/iso-date-time.helper.ts` | 14 |
| `shared/validation/pagination.ts` | 42 |
| `shared/security/*` | 41 |
| `shared/openapi/*` | 43 |
| `shared/logging/*` | 44 |
| `event/dto/create-event.dto.ts` | 14 |
| `event/dto/event-response.dto.ts` | 14, 43 |
| `event/dto/public-event-response.dto.ts` | 19, 43 |
| `event/event.repository.ts` | 15, 17, 19, 36, 42 |
| `event/event.service.ts` | 15, 17, 18, 19, 36, 42, 44 |
| `event/event.controller.ts` | 16, 17, 18, 19, 42 |
| `event/event.routes.ts` | 16, 17, 18, 19, 25, 36 |
| `ticket-type/dto/*` | 25, 26, 43 |
| `ticket-type/ticket-type.repository.ts` | 25, 28, 33, 34 |
| `ticket-type/ticket-type.service.ts` | 25, 26, 34 |
| `ticket-type/ticket-type.controller.ts`, `ticket-type.routes.ts` | 25, 26, 28 |
| `order/dto/*` | 28, 43 |
| `order/order.repository.ts` | 28, 30, 32, 33, 42 |
| `order/order.service.ts` | 28, 29, 30, 31, 32, 33, 36, 42, 44 |
| `order/order.controller.ts`, `order.routes.ts` | 28, 30, 31, 32, 36, 41 |
| `payment/stripe.ts` | 31 |
| `payment/payment.gateway.ts` | 31, 32, 34 |
| `payment/payment.service.ts` | 32, 33, 44 |
| `payment/payment.controller.ts`, `payment.routes.ts` | 32 |
| `ticket/ticket.repository.ts` | 34, 36, 40 |
| `ticket/ticket.service.ts` | 34, 35, 36, 39, 44 |
| `ticket/ticket.controller.ts`, `ticket.routes.ts` | 34, 35, 39, 40 |
| `jobs/queues.ts`, `jobs/boss.ts`, `jobs/job.queue.ts` | 35, 36 (`boss.ts` ka 44) |
| `user/*` (sh `dto/change-role.dto.ts`, `dto/user-response.dto.ts`) | 37, 42, 43, 44 |
| `event-staff/*` (sh `dto/add-staff.dto.ts`, `dto/staff-response.dto.ts`) | 38, 43, 44 |
| `scan/*` (sh `dto/scan.dto.ts`, `dto/scan-response.dto.ts`) | 40, 43, 44 |
| `*/*.openapi.ts` (iga moodul) | 43 |
| `scripts/seed.ts` | 20, 26, 30, 32, 38, 40, 45 |
| `scripts/make-admin.ts` | 37 |
| `scripts/seed-events.ts` | 46 |

### `public/` ja `tests/`

| Fail | Sammud |
|---|---|
| `public/index.html`, `public/app.js` | 9, 10, 11 |
| `tests/tsconfig.json`, `tests/global-setup.ts`, `tests/environment.test.ts`, `tests/helpers/auth.ts`, `tests/auth/me.routes.test.ts` | 21 |
| `tests/setup.ts` | 21, 35, 41 |
| `tests/helpers/factories.ts` | 22, 25, 28 |
| `tests/helpers/api.ts` | 22, 25, 28, 32 |
| `tests/helpers/stripe.ts` | 31, 32, 34, 35 |
| `tests/helpers/jobs.ts` | 35 |
| `tests/helpers/contract.ts`, `tests/docs/openapi.test.ts` | 43 |
| `tests/event/*` (sh `dto/create-event.dto.test.ts`) | 22, 36, 42, 43 |
| `tests/ticket-type/*` (sh `dto/create-ticket-type.dto.test.ts`) | 25, 26, 28, 34 |
| `tests/order/*` (sh `dto/create-order.dto.test.ts`) | 28, 29, 31, 33, 41 |
| `tests/payment/*` | 32, 33 |
| `tests/ticket/ticket.routes.test.ts` | 34, 35, 39 |
| `tests/ticket/event-cancellation.test.ts`, `tests/jobs/job.queue.test.ts` | 36 |
| `tests/user/*` | 37 |
| `tests/event-staff/*` | 38 |
| `tests/scan/*` | 40 |
| `tests/security/*` | 41, 44 |

Õpetaja materjalid (`docs/`, moodulite `README.md` failid) on asendatud nende issue'dega ja õpilaste repos neid pole.
