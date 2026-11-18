---
title: 23. Testide kaetus (coverage)
milestone: M4 – Testid
labels: test, suurus: S
---

## Eesmärk

`npm run test:coverage` näitab, milliseid koodiridu testid läbivad ja milliseid mitte. Aruande järgi leiad testimata kohad.

## Taust

- **Kaetus (coverage)** mõõdab, mitu protsenti koodiridadest ja harudest (`if`/`else`) testide ajal käivitati.
- **Kõrge kaetus ei tähenda häid teste**: test võib rida läbida ja mitte midagi kontrollida. Madal kaetus aga ütleb kindlalt, et kuskil pole üldse teste. Kasuta aruannet **testimata kohtade leidmiseks**, mitte eesmärgina.
- **Mida arvesse ei võta:** käivitusfailid (`server.ts`) ja käsurea skriptid (`src/scripts/`). Neid ei käivitata testides ja need langetaksid protsenti asjata.
- Lävendit (nt "alla 90% → CI punane") veel ei pane. Selle lisame lõpus (#48), kui kõik moodulid on olemas.
- `v8` provider kasutab Node'i sisseehitatud mõõtmist: lisaseadistust pole vaja.

## Sammud

1. Paigalda (versioon peab olema sama mis `vitest`-il):
   ```bash
   npm install -D @vitest/coverage-v8
   ```
2. `vitest.config.ts`, `test` objekti sisse:
   ```ts
   coverage: {
       provider: "v8",
       include: ["src/**/*.ts"],
       exclude: ["src/server.ts", "src/scripts/**"],
       reporter: ["text", "html"],
   },
   ```
   - `text`: tabel terminalis.
   - `html`: `coverage/index.html`, kus saab faili avada ja näha punaselt read, mida ei läbitud.
3. `package.json`:
   ```json
   "test:coverage": "vitest run --coverage"
   ```
4. `.gitignore` ja `.prettierignore`: lisa `coverage`.
5. Käivita ja ava aruanne:
   ```bash
   npm run test:coverage
   open coverage/index.html
   ```
6. Leia aruandest vähemalt üks testimata koht (nt mõni `if` haru `event.service.ts`-is või `errorHandler`-is) ja kirjuta sellele test. Mis protsent oli enne ja pärast?
7. Lisa README käskude tabelisse `test:coverage`.

## Valmis, kui…

- [ ] `npm run test:coverage` näitab tabelit ja loob `coverage/index.html`
- [ ] `coverage/` pole gitis
- [ ] Vähemalt üks aruandest leitud testimata koht on nüüd testitud

## Mida sa saavutasid

- **Nüüd töötab:** Aruanne näitab, millised koodiread on testimata, ja sa leidsid sealt vähemalt ühe ning katsid selle testiga.
- **Said selgeks:** Kaetus näitab, kus teste **pole**. Kõrge protsent ei tähenda veel, et testid head on.
- **Edasi:** Samm 48 paneb kaetusele lävendi, mille alla langemine teeb CI punaseks.

## Kontrollküsimused

1. **Kas 100% kaetus tähendab, et vigu pole?** Ei: rida võib olla läbitud ilma tulemust kontrollimata.
2. **Miks `server.ts` on välja jäetud?** Testid kasutavad `app`-i otse, serverit ei käivitata.

## Materjalid

- [Vitest: Coverage](https://vitest.dev/guide/coverage)
- [Martin Fowler: Test coverage](https://martinfowler.com/bliki/TestCoverage.html)

## Sõltub

- #22
