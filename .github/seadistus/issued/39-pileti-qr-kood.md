---
title: 39. Pileti QR-kood
milestone: M9 – Uks ja admin
labels: api, suurus: S
---

## Eesmärk

Pileti omanik saab oma kehtiva pileti QR-koodi pildina: `GET /api/tickets/:id/qr` → SVG. Selle näitab ta uksel turvamehele.

## Taust

- **QR-koodis on pileti `code`** (#27): juhuslik ja ära arvamatu. Mitte id ega muud andmed.
- **Midagi ei salvestata:** pilt tehakse igal päringul `code`-ist uuesti. Samast koodist tuleb alati sama pilt, seega pole mõtet seda andmebaasi või failina hoida.
- **SVG**, mitte PNG: tekst, väike, terav igas suuruses.
- **`res.type("image/svg+xml")`:** brauser näitab vastust pildina. Frontendis piisab `<img src="/api/tickets/:id/qr">`.
- **Ainult kehtival piletil:** tühistatud või kasutatud piletiga pole uksel midagi teha → `409`.
- **Omanik või admin**, võõras pilet → `404` (sama mis tühistamisel, #34).
- 🟢 Frontendi "Minu piletid ja QR-kood" näitab seda pilti.

## Sammud

1. Paigalda:
   ```bash
   npm install qrcode
   npm install -D @types/qrcode
   ```
2. `ticket.service.ts`:
   ```ts
   import QRCode from "qrcode";

   async qrSvg(id: string, user: AuthUser): Promise<string> {
       const ticket = await this.findOwnedById(id, user);

       if (ticket.status !== "active") {
           throw new ConflictError("QR-kood on ainult kehtival piletil");
       }

       return QRCode.toString(ticket.code, {type: "svg"});
   }
   ```
   `findOwnedById` on #34-st: sama omaniku reegel.
3. `ticket.controller.ts`:
   ```ts
   qr: RequestHandler = async (req, res) => {
       const {id} = ticketIdParams.parse(req.params);
       const svg = await this.service.qrSvg(id, req.user!);
       res.type("image/svg+xml").send(svg);
   };
   ```
   `ticket.routes.ts`: `ticketRouter.get("/:id/qr", ticketController.qr);`
4. Testid (`tests/ticket/ticket.routes.test.ts` või eraldi fail): omanik saab `200`, `content-type` sisaldab `image/svg+xml` ja keha algab `<svg`; võõras → `404`; tühistatud pilet → `409`.
5. **Proovi:** seeder → testlehe konsoolist `fetch("/api/orders/me")` → kopeeri pileti id → ava brauseris `http://localhost:3000/api/tickets/<id>/qr`. Skänni telefoniga: telefon näitab pileti `code`-i.

## Valmis, kui…

- [ ] Omanik näeb brauseris oma pileti QR-koodi
- [ ] Telefoniga skännides tuleb välja pileti `code`
- [ ] Võõras pilet annab `404`, mittekehtiv `409`
- [ ] Testid on rohelised

## Mida sa saavutasid

- **Nüüd töötab:** Ostja näeb oma pileti QR-koodi ja telefoniga skännides tuleb sealt välja pileti kood.
- **Said selgeks:** QR-kood on ainult pilt koodist. Turvalisus tuleb sellest, et koodi ei saa ära arvata ja võõrast piletit ei näidata.
- **Edasi:** Järgmises sammus skännib turvamees selle koodi uksel.

## Kontrollküsimused

1. **Miks QR-koodi ei salvestata?** Sama `code` annab alati sama pildi.
2. **Miks QR-koodis on `code`, mitte pileti id?** `code` on mõeldud väljapoole näitamiseks ja on ära arvamatu.

## Materjalid

- [node-qrcode](https://github.com/soldair/node-qrcode)
- [Express: res.type](https://expressjs.com/en/api.html#res.type)

## Sõltub

- #34
