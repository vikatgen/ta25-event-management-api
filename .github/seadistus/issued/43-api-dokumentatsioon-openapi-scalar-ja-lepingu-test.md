---
title: 43. API dokumentatsioon (OpenAPI + Scalar) ja lepingu testid
milestone: M10 – Kvaliteet
labels: api, suurus: L
---

## Eesmärk

API-l on dokumentatsioon, mis tuleb **koodist** (zod skeemidest), mitte käsitsi kirjutatud failist:

- `GET /api/docs`: veebileht (Scalar), kus saab route'e vaadata ja proovida
- `GET /api/openapi.json`: masinloetav leping (OpenAPI 3.1)
- **Lepingu testid:** kui vastus ei vasta dokumentatsioonile, kukub test

## Taust

- **Käsitsi kirjutatud dokumentatsioon vananeb:** keegi muudab koodi ja unustab dokumentatsiooni. Kui dokumentatsioon tuleb samadest zod skeemidest, mis päringut valideerivad, on see alati õige.
- **Vastuse DTO-d muutuvad zod skeemideks.** Siiani olid need TypeScripti tüübid (#11, #14 jne). Nüüd `z.strictObject({...})` + `z.infer`: tüüp tuleb endiselt skeemist ja skeemist tuleb dokumentatsioon. `strictObject`: lisaväli vastuses on viga, nii ei lähe kogemata midagi dokumenteerimata välja.
- **Iga moodul registreerib oma route'id** (`event.openapi.ts` jne). Dokumentatsioon on mooduli juures, mitte ühes hiiglaslikus failis.
- **Lepingu test** (`expectMatchesContract`) kontrollib kolme asja: route on dokumenteeritud, see staatuskood on dokumenteeritud, keha vastab skeemile.
- **Docs leht vajab leebemat CSP-d** (#41): Scalar laeb skripte CDN-ist. Ainult `/api/docs` route'il, mitte kogu API-l.
- 🟢 **Frontend genereerib sellest lepingust TypeScripti tüübid** (frontendi repo `gen:api`). Kui backend muudab vastuse kuju, näeb frontend TypeScripti viga kohe.

## Sammud

1. Paigalda:
   ```bash
   npm install @asteasolutions/zod-to-openapi @scalar/express-api-reference
   ```
2. `src/shared/openapi/registry.ts`:
   ```ts
   import {OpenAPIRegistry} from "@asteasolutions/zod-to-openapi";

   export const registry = new OpenAPIRegistry();
   ```
3. `src/shared/openapi/responses.ts`: ühine veaskeem ja abifunktsioonid, et iga route ei kordaks sama:
   ```ts
   import type {ResponseConfig} from "@asteasolutions/zod-to-openapi";
   import z from "zod";
   import {registry} from "./registry.js";

   export const errorSchema = z
       .strictObject({
           error: z.string(),
           details: z.record(z.string(), z.array(z.string()).optional()).optional(),
       })
       .meta({id: "Error"});

   const ERROR_DESCRIPTIONS = {
       400: "Vigane päring (`details` ütleb, mis väljal mis viga)",
       401: "Pole sisse logitud",
       403: "Puudub õigus (vale roll või mitte sinu oma)",
       404: "Ei leitud",
       409: "Konflikt andmete praeguse olekuga (`error` ütleb põhjuse)",
       429: "Liiga palju päringuid",
   } as const;

   type ErrorCode = keyof typeof ERROR_DESCRIPTIONS;

   export function json(schema: z.ZodType, description: string): ResponseConfig {
       return {description, content: {"application/json": {schema}}};
   }

   export function errors(...codes: ErrorCode[]): Record<number, ResponseConfig> {
       return Object.fromEntries(codes.map((code) => [code, json(errorSchema, ERROR_DESCRIPTIONS[code])]));
   }

   const cookieAuth = registry.registerComponent("securitySchemes", "cookieAuth", {
       type: "apiKey",
       in: "cookie",
       name: "better-auth.session_token",
   });

   export const loggedIn = [{[cookieAuth.name]: []}];
   ```
4. **Vastuse DTO-d zod skeemideks.** Näiteks `event-response.dto.ts`:
   ```ts
   export const eventResponseSchema = z.strictObject({
       id: z.uuid(),
       title: z.string(),
       // ...
       imageUrl: z.url().nullable(),
       startsAt: z.iso.datetime(),
       status: z.enum(statusEnum.enumValues),
       createdAt: z.iso.datetime(),
       updatedAt: z.iso.datetime(),
   });

   export type EventResponseDto = z.infer<typeof eventResponseSchema>;
   ```
   `toEventResponse` jääb samaks. Tee sama: `meResponseSchema`, `publicEventResponseSchema`, `ticketTypeResponseSchema`, `publicTicketTypeResponseSchema`, `ticketResponseSchema` + `orderResponseSchema` + `checkoutResponseSchema` (`orderResponseSchema.extend({checkoutUrl: z.url()})`), `userResponseSchema`, `staffResponseSchema`, `scanResponseSchema`.
5. **Iga mooduli route'id.** `src/event/event.openapi.ts` (näidis kahe route'iga, ülejäänud samamoodi):
   ```ts
   import z from "zod";
   import {registry} from "../shared/openapi/registry.js";
   import {errors, json, loggedIn} from "../shared/openapi/responses.js";
   import {paginationQuery} from "../shared/validation/pagination.js";
   import {createEventDto} from "./dto/create-event.dto.js";
   import {eventResponseSchema} from "./dto/event-response.dto.js";
   import {publicEventResponseSchema} from "./dto/public-event-response.dto.js";
   import {eventIdParams} from "./event.controller.js";

   export function registerEventPaths(): void {
       const PublicEvent = publicEventResponseSchema.meta({id: "PublicEvent"});
       const Event = eventResponseSchema.meta({id: "Event"});
       const CreateEvent = createEventDto.meta({id: "CreateEvent"});

       registry.registerPath({
           method: "get",
           path: "/api/public/events",
           tags: ["Üritused (avalik)"],
           summary: "Avaldatud üritused",
           request: {query: paginationQuery},
           responses: {200: json(z.array(PublicEvent), "Avaldatud üritused algusaja järgi"), ...errors(400)},
       });

       registry.registerPath({
           method: "post",
           path: "/api/events",
           tags: ["Üritused (haldus)"],
           summary: "Loo üritus (mustand)",
           security: loggedIn,
           request: {body: {content: {"application/json": {schema: CreateEvent}}}},
           responses: {201: json(Event, "Loodud mustand"), ...errors(400, 401, 403)},
       });
   }
   ```
   - `.meta({id})`: skeem tuleb dokumentatsiooni nimega ("Event") ja seda saab korduvalt kasutada.
   - `path` on OpenAPI kujul: `{id}`, mitte `:id`.
   - Kirjuta iga moodulile oma fail: `auth.openapi.ts` (sh Better Authi `sign-in/social` ja `sign-out`), `event`, `ticket-type`, `event-staff`, `order`, `payment` (webhook), `ticket` (sh QR: `content: {"image/svg+xml": ...}`), `scan`, `user`.
6. `src/shared/openapi/document.ts`:
   ```ts
   import {OpenApiGeneratorV31} from "@asteasolutions/zod-to-openapi";
   import {env} from "../../config/env.js";
   import {registerAuthPaths} from "../../auth/auth.openapi.js";
   import {registerEventPaths} from "../../event/event.openapi.js";
   // ... teised moodulid
   import {registry} from "./registry.js";

   registerAuthPaths();
   registerEventPaths();
   // ...

   export const openApiDocument = new OpenApiGeneratorV31(registry.definitions).generateDocument({
       openapi: "3.1.0",
       info: {title: "Piletirakenduse API", version: "1.0.0"},
       servers: [{url: env.BETTER_AUTH_URL}],
   });
   ```
7. `src/shared/openapi/docs.routes.ts`:
   ```ts
   import {apiReference} from "@scalar/express-api-reference";
   import {Router} from "express";
   import helmet from "helmet";
   import {openApiDocument} from "./document.js";

   export const docsRouter = Router();

   docsRouter.get("/openapi.json", (_req, res) => {
       res.json(openApiDocument);
   });

   const docsCsp = helmet.contentSecurityPolicy({
       directives: {
           scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
           styleSrc: ["'self'", "'unsafe-inline'", "https:"],
           fontSrc: ["'self'", "https:", "data:"],
           imgSrc: ["'self'", "data:", "https:"],
           connectSrc: ["'self'"],
       },
   });

   docsRouter.use("/docs", docsCsp, apiReference({url: "/api/openapi.json"}));
   ```
   `src/app.ts`, pärast `express.json()`: `app.use("/api", docsRouter);`
8. **Lepingu testid.** `tests/helpers/contract.ts`:
   ```ts
   import type {ResponseConfig, RouteConfig} from "@asteasolutions/zod-to-openapi";
   import type {Response} from "supertest";
   import {expect} from "vitest";
   import type {ZodType} from "zod";
   import {registry} from "../../src/shared/openapi/registry.js";
   import "../../src/shared/openapi/document.js";

   type Method = RouteConfig["method"];

   export function expectMatchesContract(response: Response, method: Method, path: string): void {
       const route = registry.definitions
           .filter((definition) => definition.type === "route")
           .find((definition) => definition.route.method === method && definition.route.path === path)?.route;

       expect(route, `${method.toUpperCase()} ${path} puudub dokumentatsioonist`).toBeDefined();

       const documented = route!.responses[response.status] as ResponseConfig | undefined;
       expect(documented, `${method.toUpperCase()} ${path}: vastus ${response.status} puudub dokumentatsioonist`).toBeDefined();

       const schema = (documented!.content?.["application/json"] as {schema: ZodType} | undefined)?.schema;
       if (!schema) {
           return;
       }

       const result = schema.safeParse(response.body);
       expect(result.error?.issues ?? [], `${method.toUpperCase()} ${path}: vastus ei vasta skeemile`).toEqual([]);
   }
   ```
   - `import "../../src/shared/openapi/document.js"`: käivitab registreerimise.
   - Lisa olemasolevatesse route'i testidesse peamiste vastuste juurde: `expectMatchesContract(response, "post", "/api/events");`
   - `tests/docs/openapi.test.ts`: `/api/openapi.json` → `openapi: "3.1.0"`, `paths` sisaldab `/api/orders`, `components.schemas` sisaldab `Event`; `/api/docs` → `text/html`.
9. **Proovi:** ava http://localhost:3000/api/docs. Muuda meelega `toEventResponse`-is üks väljanimi: lepingu test kukub.
10. Lisa README-sse dokumentatsiooni aadressid.

## Valmis, kui…

- [ ] `/api/docs` näitab kõiki route'e koos päringu ja vastuse kujuga
- [ ] `/api/openapi.json` on OpenAPI 3.1 dokument
- [ ] Peamised route'i testid kontrollivad vastust lepingu vastu
- [ ] Frontendi `gen:api` käsk saab sellest tüübid genereerida

## Mida sa saavutasid

- **Nüüd töötab:** API-l on koodist genereeritud dokumentatsioon ja testid kontrollivad, et vastused vastavad sellele.
- **Said selgeks:** Kood on ainus tõe allikas: dokumentatsioon tuleb zod skeemidest. Lepingu test püüab kinni, kui need lahku lähevad.
- **Edasi:** Selle dokumendi järgi saab frontend genereerida endale tüübid.

## Kontrollküsimused

1. **Miks dokumentatsioon tuleb koodist?** Käsitsi kirjutatud dokumentatsioon vananeb.
2. **Mida kontrollib lepingu test?** Et route ja staatuskood on dokumenteeritud ja keha vastab skeemile.
3. **Miks `strictObject`?** Dokumenteerimata lisaväli vastuses on viga.

## Materjalid

- [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.0)
- [zod-to-openapi](https://github.com/asteasolutions/zod-to-openapi)
- [Scalar: Express](https://github.com/scalar/scalar/tree/main/integrations/express)

## Sõltub

- #42
