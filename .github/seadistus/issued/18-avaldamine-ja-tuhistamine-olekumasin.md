---
title: 18. Avaldamine ja tühistamine (olekumasin)
milestone: M3 – Üritused
labels: api, suurus: M
---

## Eesmärk

Korraldaja saab mustandi **avaldada** ja avaldatud ürituse **tühistada**. Vale üleminek (nt tühistatud ürituse uuesti avaldamine) annab `409`.

| Meetod | Aadress | Üleminek |
|---|---|---|
| `POST` | `/api/events/:id/publish` | `draft` → `published` |
| `POST` | `/api/events/:id/cancel` | `published` → `cancelled` |

## Taust

**Olekumasin:** üritusel on olek ja üleminekud on lubatud ainult kindlast olekust.

```
draft ──publish──▶ published ──cancel──▶ cancelled
  │
  └── DELETE (#17, ainult mustand)
```

- Kõik ülejäänud üleminekud on keelatud → `409 Conflict` ("päring on korrektne, aga andmete praegune olek ei luba").
- **Tegevus, mitte andmete asendamine:** seepärast `POST /:id/publish`, mitte `PUT` koos `status: "published"`-iga. Nii ei saa klient olekut suvaliselt valida (`PUT` DTO-s `status`-t polegi).
- Kaks tegevust teevad sama asja (kontrolli omanikku → kontrolli olekut → muuda), seega teeme ühe privaatse meetodi `changeStatus(id, user, from, to)`.
- `completed` olek on enumis olemas, aga seda ei sea ükski route: see on "üritus on möödas" ja tuleb seederist (#20).
- Tühistamine muudab praegu ainult olekut. Ostetud piletite tagasimaksed lisanduvad hiljem (#36).

## Sammud

1. `event.service.ts` (impordi ka `EventStatusEnum`):
   ```ts
   async publish(id: string, user: AuthUser): Promise<Event> {
       return this.changeStatus(id, user, "draft", "published");
   }

   async cancel(id: string, user: AuthUser): Promise<Event> {
       return this.changeStatus(id, user, "published", "cancelled");
   }

   private async changeStatus(
       id: string,
       user: AuthUser,
       from: EventStatusEnum,
       to: EventStatusEnum,
   ): Promise<Event> {
       const event = await this.findOwnedById(id, user);

       if (event.status !== from) {
           throw new ConflictError(`Üritust olekus "${event.status}" ei saa muuta olekusse "${to}"`);
       }

       const updated = await this.repository.update(id, {status: to});

       if (!updated) {
           throw new NotFoundError("Üritust ei leitud");
       }

       return updated;
   }
   ```
   - `private`: väljastpoolt saab kutsuda ainult `publish` ja `cancel`, mitte suvalist üleminekut.
   - Repository `update` (#17) sobib, sest võtab `Partial<CreateEvent>`.
2. `event.controller.ts`:
   ```ts
   publish: RequestHandler = async (req, res) => {
       const {id} = eventIdParams.parse(req.params);
       const event = await this.service.publish(id, req.user!);
       res.json(toEventResponse(event));
   };

   cancel: RequestHandler = async (req, res) => {
       const {id} = eventIdParams.parse(req.params);
       const event = await this.service.cancel(id, req.user!);
       res.json(toEventResponse(event));
   };
   ```
3. `event.routes.ts`:
   ```ts
   eventRouter.post("/:id/publish", eventController.publish);
   eventRouter.post("/:id/cancel", eventController.cancel);
   ```
4. Proovi konsoolist (`fetch(url, {method: "POST"})`):
   - mustand → publish → `200`, `status: "published"`
   - sama uuesti publish → `409`
   - cancel → `200`, `status: "cancelled"`
   - tühistatud → publish → `409`
   - avaldatud ürituse `DELETE` → `409` (#17 lõpust)

## Valmis, kui…

- [ ] Lubatud üleminekud töötavad, keelatud annavad `409` arusaadava teatega
- [ ] Võõra ürituse olekut ei saa muuta (`403`)
- [ ] Olekut ei saa muuta `PUT`-iga

## Mida sa saavutasid

- **Nüüd töötab:** Üritust saab avaldada ja tühistada ning vale üleminek annab arusaadava `409`.
- **Said selgeks:** Olekumasin: lubatud üleminekud on koodis kirjas ja kõik ülejäänud on keelatud.
- **Edasi:** Avaldatud üritused on nüüd olemas. Järgmine samm näitab neid kõigile.

## Kontrollküsimused

1. **Miks `POST /:id/publish`, mitte `PUT` koos `status`-ega?** Klient ei saa olekut suvaliselt valida, ainult lubatud tegevusi teha.
2. **Miks `409`, mitte `400`?** Päring ise on korrektne, olek ei luba.
3. **Miks `changeStatus` on `private`?** Muidu saaks kutsuda suvalist üleminekut.

## Materjalid

- 📖 [M6 › Kihid: kes mida teeb?](https://vikatgen.github.io/oppematerjalid/veebirakendused/backend/02-kihiline-arhitektuur): route, middleware, controller, service, repository ja miks reeglid on service'is
- [MDN: 409 Conflict](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/409)
- [Refactoring Guru: State](https://refactoring.guru/design-patterns/state) (taust, me teeme lihtsama variandi)

## Sõltub

- #17
