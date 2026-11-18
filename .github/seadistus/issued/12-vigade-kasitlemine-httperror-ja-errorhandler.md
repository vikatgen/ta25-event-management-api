---
title: 12. Vigade käsitlemine: HttpError ja errorHandler
milestone: M2 – Vead
labels: api, suurus: M
---

## Eesmärk

Kõik vead muudetakse HTTP vastuseks **ühes kohas**. Service saab kirjutada `throw new NotFoundError("Üritust ei leitud")` ja klient saab `404 {"error": "Üritust ei leitud"}`. Ootamatu viga annab alati `500`, ilma sisemisi detaile reetmata.

## Taust

Ilma ühise veakäsitluseta peaks iga route ise `try/catch`-i ja `res.status(...)` tegema. See kordub ja ununeb. Muster:

```
service: throw new NotFoundError()  ──►  Express 5  ──►  errorHandler  ──►  404 {"error": "..."}
```

- **Express 5 püüab `async` funktsioonide vead ise kinni** ja saadab need error middleware'ile. (Express 4-s oli vaja `try/catch` + `next(err)`.)
- **Error middleware'il on 4 parameetrit** `(err, req, res, next)`: selle järgi tunneb Express ta ära. Ta peab olema `app.ts`-is **viimane**.
- **`HttpError` on `abstract`:** seda ei saa ise luua, ainult alamklasse. Vea viskaja peab valima, mis viga see täpselt on.
- **Ootamatu viga (`500`) ei näita kliendile päris teadet**: see võib sisaldada SQL-i või saladusi. Päris viga läheb ainult logisse.
- **`StatusCode` objekt** on selleks, et koodis poleks "maagilisi numbreid": `StatusCode.NOT_FOUND` ütleb rohkem kui `404`.
- 🟢 Frontendis oli `ApiError` klass, mis luges `{error, details}` vastust. See issue teeb selle vastuse kuju.

## Sammud

1. `src/shared/http/status-codes.ts`:
   ```ts
   export const StatusCode = {
       OK: 200,
       CREATED: 201,
       NO_CONTENT: 204,
       BAD_REQUEST: 400,
       UNAUTHORIZED: 401,
       FORBIDDEN: 403,
       NOT_FOUND: 404,
       CONFLICT: 409,
       INTERNAL_SERVER_ERROR: 500,
   } as const;

   export type StatusCode = (typeof StatusCode)[keyof typeof StatusCode];
   ```
   - `as const`: `NOT_FOUND` on täpselt `404`, mitte suvaline `number`, ja objekti ei saa muuta.
   - Sama nimi objektil ja tüübil: TypeScript hoiab väärtusi ja tüüpe eraldi.
   - Uued koodid (`202`, `413`, `429`) lisame siis, kui neid vaja läheb.
2. `src/shared/errors/http.errors.ts`:
   ```ts
   import {StatusCode} from "../http/status-codes.js";

   export abstract class HttpError extends Error {
       public readonly statusCode: StatusCode;

       protected constructor(message: string, statusCode: StatusCode) {
           super(message);
           this.statusCode = statusCode;
           this.name = new.target.name;
       }
   }

   export class BadRequestError extends HttpError {
       constructor(message = "Vigane päring") {
           super(message, StatusCode.BAD_REQUEST);
       }
   }

   export class UnauthorizedError extends HttpError {
       constructor(message = "Pole sisse logitud") {
           super(message, StatusCode.UNAUTHORIZED);
       }
   }

   export class ForbiddenError extends HttpError {
       constructor(message = "Puudub õigus") {
           super(message, StatusCode.FORBIDDEN);
       }
   }

   export class NotFoundError extends HttpError {
       constructor(message = "Otsitud ressurssi ei leitud") {
           super(message, StatusCode.NOT_FOUND);
       }
   }

   export class ConflictError extends HttpError {
       constructor(message = "Konflikt andmete praeguse olekuga") {
           super(message, StatusCode.CONFLICT);
       }
   }
   ```
   - `this.name = new.target.name`: logis on näha `NotFoundError`, mitte lihtsalt `Error`.
   - Millal mida: `400` klient peab päringut parandama, `403` pole sinu oma, `404` pole olemas, `409` päring on korrektne, aga läheb vastuollu andmete olekuga (nt viimane pilet on just müüdud).
3. `src/shared/errors/unexpected.error.ts`:
   ```ts
   export class UnexpectedError extends Error {
       constructor(message: string) {
           super(message);
           this.name = new.target.name;
       }
   }
   ```
   Viga, mis ei tohiks kunagi juhtuda (meie loogika viga). **Ei päri `HttpError`-ist**, seega annab alati `500`.
4. `src/shared/http/error.middleware.ts`:
   ```ts
   import type {ErrorRequestHandler} from "express";
   import z from "zod";
   import {HttpError} from "../errors/http.errors.js";
   import {StatusCode} from "./status-codes.js";

   export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
       if (err instanceof z.ZodError) {
           res.status(StatusCode.BAD_REQUEST).json({
               error: "Vigane päring",
               details: z.flattenError(err).fieldErrors,
           });
           return;
       }

       if (err instanceof SyntaxError && "body" in err) {
           res.status(StatusCode.BAD_REQUEST).json({error: "Vigane JSON"});
           return;
       }

       if (err instanceof HttpError) {
           res.status(err.statusCode).json({error: err.message});
           return;
       }

       // oxlint-disable-next-line no-console -- asendub logijaga (#44)
       console.error(err);
       res.status(StatusCode.INTERNAL_SERVER_ERROR).json({error: "Serveri viga"});
   };
   ```
   - `ZodError` → `400` + `details` väljade kaupa: `{"endsAt": ["Üritus peab lõppema pärast algust"]}`. Klient saab näidata viga õige välja juures.
   - `SyntaxError` + `body`: vigane JSON päringu kehas (selle viskab `express.json()`).
   - `_next`: alakriips ütleb "ei kasuta", aga parameeter peab olema, muidu pole see error middleware.
5. `src/app.ts`, **kõige viimaseks** (pärast `express.static`):
   ```ts
   app.use(errorHandler);
   ```
6. Kontrolli vigase JSON-iga:
   ```bash
   curl -i -X POST localhost:3000/api/me -H "Content-Type: application/json" -d "{oops"
   ```
   Vastus peab olema `400 {"error":"Vigane JSON"}`, mitte HTML veaileht.

## Valmis, kui…

- [ ] Vigane JSON annab `400 {"error":"Vigane JSON"}`
- [ ] `errorHandler` on `app.ts`-is viimane
- [ ] `npm run lint` on puhas (ainus `console.error` on märgitud erandiga)

## Mida sa saavutasid

- **Nüüd töötab:** Kõik vead muutuvad HTTP vastuseks ühes kohas ja ootamatu viga ei näita kliendile sisemisi detaile.
- **Said selgeks:** Service viskab tähendusega vea (`NotFoundError`) ja `errorHandler` otsustab, mis staatuse see saab. Controllerisse pole `try/catch`-i vaja.
- **Edasi:** Iga järgmine moodul viskab neid samu vigu.

## Kontrollküsimused

1. **Miks ei näita `500` vastus päris veateadet?** See võib sisaldada SQL-i, failiteid või saladusi.
2. **Kuidas Express teab, et `errorHandler` on error middleware?** Tal on 4 parameetrit.
3. **Miks `HttpError` on `abstract`?** Vea viskaja peab valima konkreetse vea (`NotFoundError` jne).

## Materjalid

- 📖 [M6 › Middleware ja veatöötlus](https://vikatgen.github.io/oppematerjalid/veebirakendused/backend/04-middleware-ja-veatootlus): mida middleware teeb, miks järjekord on tähtis, üks veatöötleja kõigile vigadele
- [Express: Error handling](https://expressjs.com/en/guide/error-handling.html)
- [Zod: Formatting errors](https://zod.dev/error-formatting)
- [MDN: HTTP response status codes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status)

## Sõltub

- #11
