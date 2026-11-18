---
title: 37. Admin: kasutajad ja rollid, esimene admin käsurealt
milestone: M9 – Uks ja admin
labels: api, suurus: M
---

## Eesmärk

Admin näeb kõiki kasutajaid ja saab muuta nende rolli API kaudu. Esimese admini saab teha käsurealt. Drizzle Studios käsitsi muutmist (#11) pole enam vaja.

| Meetod | Aadress | Vastus |
|---|---|---|
| `GET` | `/api/admin/users` | `200` kõik kasutajad |
| `PATCH` | `/api/admin/users/:id/role` | `200` uue rolliga kasutaja |

```bash
npm run make-admin -- sinu@gmail.com
```

## Taust

- **Muna ja kana:** rolle saab muuta ainult admin, aga alguses pole ühtegi admini. Lahendus: **käsurea skript**, mida saab käivitada ainult see, kellel on ligipääs serverile ja `.env`-ile.
- **`PATCH`, mitte `PUT`:** muudame ühte välja, mitte kogu kasutajat.
- **Oma rolli ei saa muuta** (`409`): admin võiks end kogemata `attendee`-ks teha ja kui ta on ainus admin, ei saaks keegi seda tagasi muuta.
- **Uus roll kehtib kohe:** `requireAuth` (#11) loeb kasutaja igal päringul andmebaasist, seega uuesti sisse logima ei pea.
- **Lubatud rollid tulevad `ROLES` konstandist** (#8): `z.enum(ROLES)`. Uus roll lisatakse ühes kohas.
- `userRepository` eksporditakse: turvamehe lisamine (#38) otsib kasutajat e-posti järgi.
- 🟢 Frontendi "Admin: kasutajad ja rollid" leht kasutab neid aadresse.

## Sammud

1. `src/user/user.repository.ts`:
   ```ts
   import {asc, eq} from "drizzle-orm";
   import type {Role} from "../auth/roles.js";
   import type {Database} from "../db/index.js";
   import {user} from "../db/schema/auth.js";

   export type User = typeof user.$inferSelect;

   export class UserRepository {
       constructor(private readonly db: Database) {}

       async findAll(): Promise<User[]> {
           return this.db.select().from(user).orderBy(asc(user.createdAt), asc(user.id));
       }

       async findByEmail(email: string): Promise<User | undefined> {
           const [found] = await this.db.select().from(user).where(eq(user.email, email));
           return found;
       }

       async updateRole(id: string, role: Role): Promise<User | undefined> {
           const [updated] = await this.db.update(user).set({role}).where(eq(user.id, id)).returning();
           return updated;
       }
   }
   ```
   `user` tabel on Better Authi oma (#8), aga lugeda ja `role` välja muuta võime ise.
2. `src/user/user.service.ts`:
   ```ts
   export class UserService {
       constructor(private readonly repository: UserRepository) {}

       async findAll(): Promise<User[]> {
           return this.repository.findAll();
       }

       async changeRole(id: string, role: Role, currentUser: AuthUser): Promise<User> {
           if (id === currentUser.id) {
               throw new ConflictError("Oma rolli ei saa muuta");
           }

           const updated = await this.repository.updateRole(id, role);

           if (!updated) {
               throw new NotFoundError("Kasutajat ei leitud");
           }

           return updated;
       }
   }
   ```
3. DTO-d:
   - `src/user/dto/change-role.dto.ts`: `z.object({role: z.enum(ROLES)})`
   - `src/user/dto/user-response.dto.ts`: `UserResponseDto` (`id`, `name`, `email`, `role`, `createdAt`) ja `toUserResponse(user)`. Sessioonid ja kontod ei lähe välja.
4. `src/user/user.controller.ts`: `userIdParams = z.object({id: z.uuid()})`, meetodid `findAll` ja `changeRole` (`const {role} = changeRoleDto.parse(req.body)`).
5. `src/user/user.routes.ts`:
   ```ts
   export const userRepository = new UserRepository(db);
   const userService = new UserService(userRepository);
   const userController = new UserController(userService);

   export const userRouter = Router();

   userRouter.use(requireAuth, requireRole("admin"));

   userRouter.get("/", userController.findAll);
   userRouter.patch("/:id/role", userController.changeRole);
   ```
   `src/app.ts`: `app.use("/api/admin/users", userRouter);`
6. `src/scripts/make-admin.ts`:
   ```ts
   import {db, pool} from "../db/index.js";
   import {UserRepository} from "../user/user.repository.js";

   const email = process.argv[2];

   if (!email) {
       console.error("Kasutus: npm run make-admin -- sinu@email.ee");
       process.exit(1);
   }

   const repository = new UserRepository(db);
   const user = await repository.findByEmail(email);

   if (!user) {
       console.error(`Kasutajat ${email} ei leitud. Logi enne vähemalt korra sisse.`);
       process.exit(1);
   }

   await repository.updateRole(user.id, "admin");
   console.log(`${email} on nüüd admin`);

   await pool.end();
   ```
   Skript kasutab sama repository't mis API: SQL-i ei kirjutata kaks korda.
   `package.json`: `"make-admin": "tsx --env-file=.env src/scripts/make-admin.ts"`
7. Testid `tests/user/user.routes.test.ts`:
   - organizer → `403`
   - admin näeb kõiki kasutajaid
   - **uus roll kehtib kohe:** admin teeb attendee korraldajaks → sama attendee cookie'ga `POST /api/events` → `201`
   - vale roll (`"superadmin"`) → `400`
   - oma rolli muutmine → `409`
   - olematu kasutaja → `404`
8. **Proovi:** `npm run make-admin -- sinu@gmail.com`, siis testlehe konsoolist `fetch("/api/admin/users")` ja muuda mõne seeditud kasutaja rolli.
9. README: `make-admin` käsk ja märkus, et `npm run seed -- email` teeb sama (#20).

## Valmis, kui…

- [ ] Admin näeb kasutajaid ja saab rolle muuta, teised saavad `403`
- [ ] Uus roll kehtib ilma uuesti sisse logimata
- [ ] Oma rolli ei saa muuta
- [ ] `npm run make-admin` töötab ja annab olematu e-posti korral selge vea

## Mida sa saavutasid

- **Nüüd töötab:** Admin haldab kasutajate rolle API kaudu ja esimese admini saab teha käsurealt.
- **Said selgeks:** Rollide muutmine on tundlik tegevus: piirangud (oma rolli ei saa muuta) ja muudatus kehtib kohe.
- **Edasi:** Nüüd saab teha kasutajast turvamehe. Järgmine samm määrab ta üritusele.

## Kontrollküsimused

1. **Miks esimene admin tehakse käsurealt?** API kaudu saab rolle muuta ainult admin, keda alguses pole.
2. **Miks admin ei saa oma rolli muuta?** Viimane admin võiks end kogemata välja lukustada.
3. **Miks uus roll kehtib kohe?** `requireAuth` loeb kasutaja igal päringul andmebaasist.

## Materjalid

- 📖 [M6 › Autentimine ja autoriseerimine](https://vikatgen.github.io/oppematerjalid/veebirakendused/backend/08-autentimine-ja-autoriseerimine): kes sa oled vs mida sa tohid, roll vs omanik, 401 vs 403 vs 404
- [MDN: PATCH](https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods/PATCH)
- [OWASP API5: Broken Function Level Authorization](https://owasp.org/API-Security/editions/2023/en/0xa5-broken-function-level-authorization/)

## Sõltub

- #22
