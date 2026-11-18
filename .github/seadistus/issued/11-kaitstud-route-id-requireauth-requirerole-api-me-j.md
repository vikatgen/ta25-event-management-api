---
title: 11. Kaitstud route'id: requireAuth, requireRole, /api/me ja logout
milestone: M1 – Sisselogimine
labels: api, suurus: M
---

## Eesmärk

- `GET /api/me` tagastab sisselogitud kasutaja, muidu `401`.
- `requireRole("organizer")` laseb edasi ainult õige rolliga kasutaja (admin pääseb alati), muidu `403`.
- Testlehel on väljalogimise nupp.

## Taust

Iga üritus ja pilet vajab hiljem kontrolli "kas oled sisse logitud?" ja "kas sul on õigus?". Teeme selle **üks kord middleware'ina** ja paneme route'ide ette.

| Kood | Tähendus | Millal |
|---|---|---|
| `401 Unauthorized` | "Ma ei tea, kes sa oled" | sessiooni pole → logi sisse |
| `403 Forbidden` | "Tean, kes sa oled, aga sul pole luba" | vale roll → sisselogimine ei aita |

- **Middleware** on funktsioon `(req, res, next)`, mis jookseb enne route'i. `next()` = "minu töö on tehtud, järgmine palun". 🟢 Vue Routeris on sama mõte `beforeEach` navigation guard'il.
- `req.user` välja Expressi tüüpides pole. Lisame selle ise (`declare global`).
- Logout'i ei kirjuta me ise: Better Authil on `POST /api/auth/sign-out` olemas.

## Sammud

1. `src/auth/express.d.ts`:
   ```ts
   import type {auth} from "./auth.js";

   export type AuthUser = typeof auth.$Infer.Session.user;

   declare global {
       namespace Express {
           interface Request {
               user?: AuthUser;
           }
       }
   }
   ```
   - Kasutaja tüüp tuletatakse Better Authi seadistusest: `role` on seal automaatselt.
   - `user?` on valikuline, sest TypeScript ei tea, kas route'i ees on `requireAuth`.
   - See on selle issue keerulisim fail: esita see retseptina.
2. `src/auth/require-auth.middleware.ts`:
   ```ts
   import type {RequestHandler} from "express";
   import {fromNodeHeaders} from "better-auth/node";
   import {auth} from "./auth.js";
   import type {AuthUser} from "./express.js";

   export const requireAuth: RequestHandler = async (req, res, next) => {
       const session = await auth.api.getSession({headers: fromNodeHeaders(req.headers)});

       if (!session) {
           res.status(401).json({error: "Pole sisse logitud"});
           return;
       }

       req.user = session.user;
       next();
   };

   export const requireRole =
       (...roles: NonNullable<AuthUser["role"]>[]): RequestHandler =>
       (req, res, next) => {
           const role = req.user?.role;

           if (role === "admin" || (role && roles.includes(role))) {
               next();
               return;
           }

           res.status(403).json({error: "Puudub õigus"});
       };
   ```
   - `return` pärast `res.status(401)` on oluline: muidu jõuaks kood `next()`-ini.
   - **`requireRole` on funktsioon, mis tagastab funktsiooni.** `requireRole("organizer")` *teeb* middleware'i, mis teab lubatud rolli.
   - `NonNullable<AuthUser["role"]>`: ainult päris rollid. `requireRole("vale")` annab TS vea.
   - Kasutatakse **pärast** `requireAuth`-i: `router.post("/", requireAuth, requireRole("organizer"), handler)`.
3. `src/auth/dto/me-response.dto.ts`:
   ```ts
   import type {AuthUser} from "../express.js";
   import type {Role} from "../roles.js";

   export type MeResponseDto = {
       id: string;
       name: string;
       email: string;
       image: string | null;
       role: Role | null;
   };

   export function toMeResponse(user: AuthUser): MeResponseDto {
       return {
           id: user.id,
           name: user.name,
           email: user.email,
           image: user.image ?? null,
           role: user.role ?? null,
       };
   }
   ```
   **Valitud väljad, mitte terve `req.user`:** kui tabelisse lisandub hiljem midagi tundlikku, ei lähe see kogemata kliendile. DTO (Data Transfer Object) = andmete kuju, mis läheb üle võrgu.
4. `src/auth/me.routes.ts`:
   ```ts
   import {Router} from "express";
   import {requireAuth} from "./require-auth.middleware.js";
   import {toMeResponse} from "./dto/me-response.dto.js";

   export const meRouter = Router();

   meRouter.get("/me", requireAuth, (req, res) => {
       res.json(toMeResponse(req.user!));
   });
   ```
   `req.user!`: `!` ütleb TypeScriptile "see on kindlasti olemas". Õige, sest `requireAuth` on ees.
5. `src/app.ts`, `express.json()` järele:
   ```ts
   app.use("/api", meRouter);
   ```
6. `public/index.html`: lisa `<button id="logout">Logi välja</button>` ja asenda `<pre id="session">` → `<pre id="me">`.
   `public/app.js`: asenda `get-session` päring:
   ```js
   document.getElementById("logout").onclick = async () => {
       await fetch("/api/auth/sign-out", {method: "POST"});
       window.location.reload();
   };

   fetch("/api/me")
       .then(async (res) => `${res.status}\n${JSON.stringify(await res.json(), null, 2)}`)
       .then((text) => (document.getElementById("me").textContent = text));
   ```
7. Proovi `requireRole`-i ajutise route'iga `me.routes.ts`-is:
   ```ts
   meRouter.get("/organizer-only", requireAuth, requireRole("organizer"), (req, res) => {
       res.json({ok: true});
   });
   ```
   1. Brauseris http://localhost:3000/api/organizer-only → `403`
   2. Studios muuda oma `user.role` → `organizer`, värskenda → `200`
   3. Pane `admin` → `200` (admin pääseb alati)
   4. **Kustuta ajutine route** ja jäta oma roll `organizer`-iks: järgmistes issuedes lood üritusi.
8. Kontrolli:
   ```bash
   curl -i localhost:3000/api/me      # 401 {"error":"Pole sisse logitud"}
   ```
   Brauseris: sisse logides `200` + andmed, "Logi välja" järel `401` ja Studios on `session` rida kadunud.

## Valmis, kui…

- [ ] `/api/me` annab sisselogituna `200` ja väljalogituna `401`
- [ ] `requireRole` andis `403` / `200` vastavalt rollile ja admin pääses alati läbi
- [ ] Ajutine route on kustutatud
- [ ] Väljalogimine kustutab sessiooni

## Mida sa saavutasid

- **Nüüd töötab:** Route'e saab kaitsta: sisselogimata kasutaja saab `401`, vale rolliga kasutaja `403`. `/api/me` ütleb, kes sa oled.
- **Said selgeks:** Middleware'i ahel ning vahe autentimise (kes sa oled?) ja autoriseerimise (mida sa tohid?) vahel.
- **Edasi:** `requireAuth` ja `requireRole` kaitsevad edaspidi iga route'i.

## Kontrollküsimused

1. **Mis vahe on 401 ja 403 vahel?** 401 = ei tea, kes sa oled. 403 = tean, aga sul pole õigust.
2. **Miks on `requireAuth`-is pärast `res.status(401)` vaja `return`-i?** Muidu jookseks route ilma kasutajata.
3. **Miks `requireRole` tagastab funktsiooni?** Express ootab kuju `(req, res, next)`. Rollid tuleb anda ette, seega funktsioon teeb selle middleware'i.

## Materjalid

- 📖 [M6 › Päringu ja vastuse tsükkel](https://vikatgen.github.io/oppematerjalid/veebirakendused/backend/01-paringu-ja-vastuse-tsukkel): päring, vastus, staatusekoodid, miks server ei mäleta eelmist päringut
- 📖 [M6 › Middleware ja veatöötlus](https://vikatgen.github.io/oppematerjalid/veebirakendused/backend/04-middleware-ja-veatootlus): mida middleware teeb, miks järjekord on tähtis, üks veatöötleja kõigile vigadele
- 📖 [M6 › Autentimine ja autoriseerimine](https://vikatgen.github.io/oppematerjalid/veebirakendused/backend/08-autentimine-ja-autoriseerimine): kes sa oled vs mida sa tohid, roll vs omanik, 401 vs 403 vs 404
- 📖 [M6 › Küpsised, sessioonid ja tokenid](https://vikatgen.github.io/oppematerjalid/veebirakendused/backend/09-sessioonid-ja-tokenid): küpsise atribuudid, sessioon andmebaasis vs JWT, väljalogimine
- [Express: Using middleware](https://expressjs.com/en/guide/using-middleware.html)
- [Better Auth: Session management](https://www.better-auth.com/docs/concepts/session-management)
- [MDN: 401](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/401) · [403](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/403)

## Sõltub

- #9
