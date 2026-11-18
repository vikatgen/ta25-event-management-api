---
title: 2. package.json, README ja kaustastruktuur
milestone: M0 – Projekti algus
labels: seadistus, suurus: S
---

## Eesmärk

Projektil on korralik `package.json`, README ja kokkulepitud kaustastruktuur, mille järgi iga uus moodul tuleb samasse kohta.

## Taust

`npm init -y` jätab `package.json`-i poolikuks: nimi on kaustanimi, kirjeldus tühi ja `main: index.js` osutab failile, mida pole. Kui seda nüüd ei paranda, jääb see nii.

**Kood on kaustades domeeni kaupa, mitte kihi kaupa.** Kõik ürituse failid on koos, mitte "kõik controllerid ühes kaustas":

```
src/
├── event/                 ← üks domeen = üks kaust
│   ├── event.routes.ts        aadressid + ühendused (DI)
│   ├── event.controller.ts    HTTP: valideeri, kutsu service'it, tee vastus
│   ├── event.service.ts       äriloogika
│   ├── event.repository.ts    ainus koht, kus on SQL
│   └── dto/                   päringu ja vastuse kujud
├── shared/                ← mitme domeeni ühine (vead, valideerimine)
├── config/                ← keskkonnamuutujad
├── db/                    ← andmebaasi ühendus ja skeemid
├── scripts/               ← käsurea skriptid (seeder, make-admin)
├── app.ts
└── server.ts
tests/                     ← peegeldab src/ struktuuri
```

🟢 Frontendis oli sama mõte: `features/<nimi>/` hoiab kõik ühe teema failid koos.

Neid kaustu ei loo me korraga. **Iga kaust tekib issues, kus seda esimest korda vaja läheb.** README tabel näitab ainult plaani.

## Sammud

1. `package.json`: pane `name` (`event-management-api`), `description` (üks lause), kustuta `main`, `keywords`, `author`, `license` ja `"version"` jäta `0.1.0`.
2. Kirjuta `README.md` üle. Praegu on seal ainult viide alustamisjuhendile `ALUSTA.md`, mis jääb alles. Uues README-s on:
   - mis rakendus see on (2-3 lauset)
   - **Käivitamine** (praegu: `npm install`, `npm run server`)
   - **Kaustastruktuur** (ülaltoodud puu)
   - **Käsud** (tabel: käsk → mida teeb). Seda täiendame iga uue skriptiga.
3. Lisa README-sse rida, et issued tehakse järjekorras ja iga hilisem sõltub varasematest.
4. Commit:
   ```bash
   git commit -am "docs: readme ja package.json korda"
   ```

## Valmis, kui…

- [ ] `package.json`-is on õige nimi ja kirjeldus, `main` puudub
- [ ] README kirjeldab käivitamist ja kaustastruktuuri
- [ ] `npm run server` töötab endiselt

## Mida sa saavutasid

- **Nüüd töötab:** Projektil on korralik `package.json` ja README, mis ütleb, kuidas seda käivitada.
- **Said selgeks:** Kood jaotatakse kaustadesse **domeeni kaupa** (`event/`, `order/`), mitte kihi kaupa, ja kaust tekib alles siis, kui seda vaja on.
- **Edasi:** README käskude tabelit täiendad iga uue skriptiga, nii et see jääb kogu aeg tõeseks.

## Materjalid

- [npm: package.json](https://docs.npmjs.com/cli/configuring-npm/package-json)
- [Make a README](https://www.makeareadme.com/)

## Sõltub

- #1
