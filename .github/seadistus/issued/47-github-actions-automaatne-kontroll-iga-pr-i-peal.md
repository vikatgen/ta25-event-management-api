---
title: 47. GitHub Actions: automaatne kontroll iga PR-i peal
milestone: M10 – Kvaliteet
labels: ci, suurus: S
---

## Eesmärk

Iga pull request ja `master`-i push käivitab GitHub Actionsis automaatse kontrolli: lint, vorming, TypeScript ja testid (päris Postgresiga). Punast PR-i ei liideta.

## Taust

- Siiani pidi igaüks ise meeles pidama, et enne PR-i jooksutada `lint`, `typecheck` ja `test` (PR mall, #4). **CI** (Continuous Integration) teeb seda automaatselt ja kõigile ühtemoodi.
- **Testid vajavad Postgresi.** GitHub Actions oskab käivitada teenuse konteineri (`services`), sama mis meie `postgres-test` Docker Composes (#21): sama kasutaja, parool, baasi nimi ja port. `.env.test` on gitis, seega töötab see CI-s ilma lisaseadistuseta.
- **Node'i versioon** tuleb `.nvmrc`-st (#3): CI ja arendajad kasutavad sama.
- **`npm ci`**, mitte `npm install`: paigaldab täpselt `package-lock.json`-i versioonid ja on kiirem.
- 🟢 Frontendi repos on sama workflow (ilma andmebaasita).

## Sammud

1. `.github/workflows/ci.yml`:
   ```yaml
   name: CI

   on:
     pull_request:
     push:
       branches: [master]

   jobs:
     check:
       runs-on: ubuntu-latest

       services:
         postgres:
           image: postgres:16-alpine
           env:
             POSTGRES_USER: test
             POSTGRES_PASSWORD: test
             POSTGRES_DB: app_test
           ports:
             - 5433:5432
           options: >-
             --health-cmd pg_isready
             --health-interval 5s
             --health-timeout 5s
             --health-retries 10

       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with:
             node-version-file: .nvmrc
             cache: npm
         - run: npm ci
         - run: npm run lint
         - run: npm run format:check
         - run: npm run typecheck
         - run: npm run test:coverage
   ```
   - `ports: 5433:5432`: sama port mis `.env.test`-is.
   - `--health-cmd pg_isready`: sammud algavad alles siis, kui Postgres vastab.
   - `cache: npm`: paketid salvestatakse järgmise korra jaoks.
   - `test:coverage` (#23): testid + kaetuse aruanne. Lävend tuleb #48-s.
2. Tee PR ja vaata vahekaarti **Checks**. Kui midagi kukub, loe logi, paranda ja push'i uuesti.
3. **Proovi meelega:** tee haru, kus üks test kukub. PR-is on punane rist.
4. **Haru kaitse** (repo omanik): Settings → Branches → Add rule `master` → "Require status checks to pass" → vali `check`. Nüüd ei saa punast PR-i liita.
5. PR mallis (#4) võib käsitsi kontrolli read alles jätta (kiirem kohapeal teada saada), aga lisa rida "CI on roheline".
6. README-sse CI märk:
   ```markdown
   ![CI](https://github.com/<kasutaja>/<repo>/actions/workflows/ci.yml/badge.svg)
   ```

## Valmis, kui…

- [ ] Iga PR käivitab CI ja see on roheline
- [ ] Kukkuv test teeb PR-i punaseks
- [ ] `master` haru nõuab rohelist CI-d
- [ ] README-s on CI märk

## Mida sa saavutasid

- **Nüüd töötab:** Iga PR käivitab GitHubis automaatse kontrolli ja punast PR-i ei saa liita.
- **Said selgeks:** CI kordab kõiki kontrolle puhtas masinas, nii et "minu arvutis töötab" enam ei loe.
- **Edasi:** Alates nüüd näitab roheline linnuke, et PR on liitmiseks valmis.

## Kontrollküsimused

1. **Miks `npm ci`, mitte `npm install`?** Täpsed versioonid lukufailist, kiirem ja ei muuda lukufaili.
2. **Kust saab CI testandmebaasi?** `services` käivitab Postgresi konteineri, `.env.test` on gitis.
3. **Miks CI, kui PR mallis on kontrollnimekiri olemas?** Inimene unustab, CI mitte.

## Materjalid

- [GitHub Actions: Quickstart](https://docs.github.com/en/actions/writing-workflows/quickstart)
- [GitHub Actions: PostgreSQL service containers](https://docs.github.com/en/actions/use-cases-and-examples/using-containerized-services/creating-postgresql-service-containers)
- [actions/setup-node](https://github.com/actions/setup-node)

## Sõltub

- #46
