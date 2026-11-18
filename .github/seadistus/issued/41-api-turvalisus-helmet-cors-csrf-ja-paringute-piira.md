---
title: 41. API turvalisus: helmet, CORS, CSRF ja päringute piirangud
milestone: M10 – Kvaliteet
labels: turvalisus, suurus: L
---

## Eesmärk

API on kaitstud levinumate rünnakute eest: turvapäised, CORS ainult lubatud frontendile, CSRF kaitse, päringute piirang (`429`) ja päringu keha suuruse piirang (`413`). Kontrollnimekirjaks on OWASP API Security Top 10.

## Taust

```
päring → helmet (päised) → cors → /api/auth (Better Auth) → /api/payments (webhook)
       → apiLimiter (429) → originCheck (403) → express.json({limit: "10kb"}) (413) → route'id
```

| OWASP | Oht | Kaitse | Kus |
|---|---|---|---|
| API1 objekti õigused | võõra ürituse/pileti nägemine | `findOwnedById`, võõras pilet → 404 | service'id (juba tehtud) |
| API2 autentimine | võltsitud sessioon | Better Auth: `HttpOnly` + `SameSite=Lax` cookie | #8–#11 (juba tehtud) |
| API3 välja õigused | klient muudab `role`-i | zod DTO sisse, `to...Response` välja, `input: false` | DTO-d (juba tehtud) |
| API4 ressursid | päringute tulv, hiiglaslik keha, kõik read korraga | `apiLimiter`, `orderLimiter`, `limit: "10kb"`, lehekülgedeks jagamine (#42) | **see issue** |
| API5 funktsiooni õigused | attendee halduse route'il | `requireRole` | routes (juba tehtud) |
| API6 äriprotsess | bot broneerib kõik piletid | üks `pending` tellimus (#33) + `orderLimiter` | **see issue** |
| API8 konfiguratsioon | turvapäised puudu, CORS `*`, CSRF | `helmet`, `cors(allowedOrigins)`, `originCheck` | **see issue** |
| API10 välised API-d | võltsitud webhook | Stripe'i allkiri | #32 (juba tehtud) |

- **`helmet`** lisab turvapäised (`X-Content-Type-Options`, `Content-Security-Policy` jne) ja eemaldab `X-Powered-By: Express`. CSP keelab inline-skriptid: seepärast oli testlehe skript algusest peale eraldi failis (#9).
- **CORS:** brauser lubab TEISE aadressi lehel (React `localhost:5173`) meie vastust lugeda ainult siis, kui me seda lubame. `credentials: true`: ka cookie'ga. **Ainult `allowedOrigins`, mitte `*`**: tärniga saaks iga leht kasutaja nimel päringuid teha.
- **CSRF:** võõras leht saab brauseril lasta saata `POST`-i meie API-le ja brauser paneb cookie kaasa. `originCheck` keelab andmeid muutvad päringud (`POST`, `PUT`, `PATCH`, `DELETE`) võõra `Origin` päisega. Päiseta päringud (curl, Postman, server) lähevad läbi: CSRF on brauseri probleem.
- **Üks nimekiri kolmele kohale:** CORS, `originCheck` ja Better Authi `trustedOrigins` kasutavad sama `allowedOrigins`-i.
- **Webhook on piirangutest üleval:** Stripe saadab palju päringuid samalt aadressilt ja `Origin` päist tal pole.
- **`orderLimiter`:** 10 ostukatset minutis **kasutaja** kohta (mitte IP), et bot ei saaks sekundiga sadu tellimusi teha.

## Sammud

1. Paigalda:
   ```bash
   npm install helmet cors express-rate-limit
   npm install -D @types/cors
   ```
2. `status-codes.ts`: lisa `PAYLOAD_TOO_LARGE: 413` ja `TOO_MANY_REQUESTS: 429`.
3. `src/shared/security/allowed-origins.ts`:
   ```ts
   import {env} from "../../config/env.js";

   export const allowedOrigins = [...new Set([env.BETTER_AUTH_URL, env.FRONTEND_URL])];
   ```
   `Set`: kui frontend on samal aadressil, on aadress nimekirjas üks kord.
   `src/auth/auth.ts`: `trustedOrigins: allowedOrigins,`
4. `src/shared/security/origin-check.middleware.ts`:
   ```ts
   import type {RequestHandler} from "express";
   import {StatusCode} from "../http/status-codes.js";
   import {allowedOrigins} from "./allowed-origins.js";

   const SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];

   export const originCheck: RequestHandler = (req, res, next) => {
       const origin = req.header("origin");

       if (SAFE_METHODS.includes(req.method) || !origin || allowedOrigins.includes(origin)) {
           next();
           return;
       }

       res.status(StatusCode.FORBIDDEN).json({error: "Päring teiselt aadressilt ei ole lubatud"});
   };
   ```
5. `src/shared/security/rate-limit.middleware.ts`:
   ```ts
   import {MemoryStore, rateLimit} from "express-rate-limit";
   import {StatusCode} from "../http/status-codes.js";

   const MINUTE = 60 * 1000;

   const apiStore = new MemoryStore();
   const orderStore = new MemoryStore();

   export const apiLimiter = rateLimit({
       windowMs: MINUTE,
       limit: 100,
       standardHeaders: "draft-8",
       legacyHeaders: false,
       store: apiStore,
       message: {error: "Liiga palju päringuid, proovi minuti pärast uuesti"},
       statusCode: StatusCode.TOO_MANY_REQUESTS,
   });

   export const orderLimiter = rateLimit({
       windowMs: MINUTE,
       limit: 10,
       standardHeaders: "draft-8",
       legacyHeaders: false,
       store: orderStore,
       keyGenerator: (req) => req.user!.id,
       message: {error: "Liiga palju ostukatseid, proovi minuti pärast uuesti"},
       statusCode: StatusCode.TOO_MANY_REQUESTS,
   });

   export async function resetRateLimits(): Promise<void> {
       await apiStore.resetAll();
       await orderStore.resetAll();
   }
   ```
   - Eraldi `store`-id, et testid saaksid neid nullida (kõik testid tulevad samalt IP-lt).
   - `orderLimiter` on `requireAuth`-i järel, seega `req.user!` on olemas.
   - `MemoryStore` on ühe serveri mälus. Mitme serveriga oleks vaja ühist hoidlat (Redis): meil on üks server.
6. `order.routes.ts`: `orderRouter.post("/", orderLimiter, orderController.create);`
7. `src/app.ts` lõplik järjekord:
   ```ts
   const app = express();

   app.use(helmet());
   app.use(cors({origin: allowedOrigins, credentials: true}));

   app.all("/api/auth/*splat", toNodeHandler(auth));
   app.use("/api/payments", paymentRouter);

   app.use("/api", apiLimiter, originCheck);
   app.use(express.json({limit: "10kb"}));

   // ... meie route'id nagu varem ...

   app.use(express.static("public"));
   app.use(errorHandler);
   ```
   - CORS on **enne** Better Authi: ka login tuleb frontendilt.
   - `limit: "10kb"`: meie päringud on alla 2 kb, vaikimisi lubaks 100 kb.
8. `error.middleware.ts`, pärast `SyntaxError` kontrolli:
   ```ts
   if (err.type === "entity.too.large") {
       res.status(StatusCode.PAYLOAD_TOO_LARGE).json({error: "Päringu keha on liiga suur"});
       return;
   }
   ```
9. `tests/setup.ts` `beforeEach`-i: `await resetRateLimits();`
10. Testid `tests/security/security.test.ts`:
    - vastuses on `x-content-type-options: nosniff` ja **pole** `x-powered-by`
    - CORS: `Origin: http://localhost:5173` → `access-control-allow-origin` sama ja `access-control-allow-credentials: true`; võõras `Origin` → päist pole
    - CSRF: `POST /api/events` võõra `Origin`-iga → `403`; lubatud `Origin`-iga → ei ole `403`
    - 101 päringut järjest → viimane `429`
    - 11 kb keha → `413`
    - `order.routes.test.ts`: 11 ostukatset minutis → `429`
11. **Proovi:** testleht töötab endiselt (sama aadress). DevTools → Network → vaata vastuse päiseid. Frontendi repo (`localhost:5173`) saab nüüd sisselogituna päringuid teha.

## Valmis, kui…

- [ ] Turvapäised on igal vastusel, `X-Powered-By` puudub
- [ ] Võõras leht ei saa vastust lugeda ega andmeid muuta
- [ ] Üle 100 päringu minutis annab `429`, üle 10 ostukatse kasutaja kohta `429`
- [ ] Üle 10 kb keha annab `413`
- [ ] Testleht ja frontend töötavad edasi

## Mida sa saavutasid

- **Nüüd töötab:** API on kaitstud levinumate rünnakute eest: turvapäised, CORS, CSRF ja päringute piirangud.
- **Said selgeks:** OWASP API Top 10 kontrollnimekirjana: mis rünnak on, mis seda peatab ja miks.
- **Edasi:** Turvalisus ei ole üks samm. Mõtle iga uue route'i juures, kes seda kuritarvitada võiks.

## Kontrollküsimused

1. **Miks mitte `cors({origin: "*"})`?** Iga leht saaks kasutaja cookie'ga päringuid teha ja vastuseid lugeda.
2. **Miks päiseta päringud lähevad `originCheck`-ist läbi?** CSRF on brauseri rünnak; brauser saadab `Origin` päise alati.
3. **Miks webhook on piirangutest üleval?** Stripe saadab palju päringuid ja `Origin`-it tal pole; kaitse on allkiri.

## Materjalid

- 📖 [M6 › API turvalisus](https://vikatgen.github.io/oppematerjalid/veebirakendused/backend/11-api-turvalisus): päritolu ja CORS, CSRF, päringute piirang, OWASP API Top 10
- [OWASP API Security Top 10 (2023)](https://owasp.org/API-Security/editions/2023/en/0x11-t10/)
- [helmet](https://helmetjs.github.io/) · [cors](https://www.npmjs.com/package/cors) · [express-rate-limit](https://express-rate-limit.mintlify.app/)
- [Better Auth: Security](https://www.better-auth.com/docs/reference/security)
- [Express: Security best practices](https://expressjs.com/en/advanced/best-practice-security.html)

## Sõltub

- #40
