---
title: 3. Prettier, oxlint ja editorconfig (koodi ühtne stiil)
milestone: M0 – Projekti algus
labels: seadistus, suurus: M
---

## Eesmärk

Kogu kood on ühes stiilis ja see on automaatne: `npm run format` vormindab, `npm run lint` leiab vead ja Node'i versioon on projektis kirja pandud.

## Taust

Kui stiili ei kontrolli tööriist, hakkavad failid üksteisest erinema (jutumärgid, taandused, tühikud sulgudes) ja code review läheb vormistuse vaidlemiseks. Seepärast seadistame tööriistad **kohe alguses**, kui koodi on veel vähe: hilisem "vorminda kõik ära" teeb suure müra-commit'i.

| Tööriist | Mida teeb | 🟢 Frontendis |
|---|---|---|
| **Prettier** | vormindab (taandus, jutumärgid, reapikkus) | sama |
| **Oxlint** | leiab vead (kasutamata muutuja, ohtlik muster) | sama |
| `.editorconfig` | redaktor kasutab samu taanduseid | – |
| `.nvmrc` + `engines` | ütleb, millist Node'i versiooni projekt vajab | – |

**Miks Oxlint, mitte ESLint?** TypeScript 7 ja `typescript-eslint` ei tööta praegu koos. Oxlint on kiire ja töötab ilma lisaseadistuseta.

## Sammud

1. Paigalda:
   ```bash
   npm install -D prettier oxlint
   ```
2. `.prettierrc.json` (see on meie stiil: 4 tühikut, jutumärgid, `{a}` ilma tühikuteta):
   ```json
   {
     "tabWidth": 4,
     "printWidth": 120,
     "singleQuote": false,
     "bracketSpacing": false,
     "trailingComma": "all"
   }
   ```
3. `.prettierignore`:
   ```
   node_modules
   dist
   migrations
   package-lock.json
   .github/seadistus
   ```
   Migratsioonid on genereeritud: neid ei vorminda. `.github/seadistus` on issuede seadistusfailid, mitte sinu kood.
4. Oxlint: loo seadistus käsuga `npx oxlint --init`, ava loodud `.oxlintrc.json` ja lisa reegel, mis keelab `console.log`-i:
   ```json
   "rules": { "no-console": "error" },
   "overrides": [
     {
       "files": ["src/config/env.ts", "src/scripts/**"],
       "rules": { "no-console": "off" }
     }
   ]
   ```
   Hiljem kasutame logijat (`pino`). `env.ts` ja käsurea skriptid jäävad `console`-iga, sest `env.ts` töötab enne logijat ja skriptide väljund on inimesele. Neid faile veel pole, aga reegel on valmis.
5. `package.json` skriptid:
   ```json
   "lint": "oxlint",
   "format": "prettier --write .",
   "format:check": "prettier --check ."
   ```
6. `.editorconfig`:
   ```ini
   root = true

   [*]
   indent_style = space
   indent_size = 4
   end_of_line = lf
   charset = utf-8
   insert_final_newline = true
   trim_trailing_whitespace = true

   [*.{json,yaml,yml}]
   indent_size = 2
   ```
7. Node'i versioon: `.nvmrc` sisuga `22` (või sinu `node -v` suur number) ja `package.json`-i:
   ```json
   "engines": { "node": ">=22" }
   ```
8. Käivita ja paranda:
   ```bash
   npm run format
   npm run lint
   npm run typecheck
   ```
   Vaata `git diff`: mis Prettier muutis?
9. Lisa README käskude tabelisse `lint`, `format`, `format:check` ja commit:
   ```bash
   git add .
   git commit -m "chore: prettier, oxlint ja editorconfig"
   ```

## Valmis, kui…

- [ ] `npm run format:check` ja `npm run lint` on puhtad
- [ ] Meelega lisatud `console.log("x")` failis `src/app.ts` annab `npm run lint` käsul vea
- [ ] `.nvmrc`, `.editorconfig` ja `engines` on olemas
- [ ] README käskude tabel on täiendatud

## Mida sa saavutasid

- **Nüüd töötab:** Kood vormindub ühe käsuga ja lint leiab vead (nt unustatud `console.log`) enne sind.
- **Said selgeks:** Stiili peab kontrollima tööriist, mitte inimene, ja seda tasub teha alguses, kui koodi on vähe.
- **Edasi:** Alates nüüd jooksutad enne igat commit'i `format` ja `lint`. Samm 47 paneb GitHubi seda automaatselt kontrollima.

## Materjalid

- [Prettier: Options](https://prettier.io/docs/options)
- [Oxlint: Getting Started](https://oxc.rs/docs/guide/usage/linter.html)
- [EditorConfig](https://editorconfig.org/)

## Sõltub

- #2
