---
title: 4. Töövoog: issue → haru → pull request
milestone: M0 – Projekti algus
labels: seadistus, suurus: S
---

## Eesmärk

Iga issue tehakse eraldi harus ja jõuab `master`-isse pull requesti kaudu. Nii näeb hiljem, mis muudatus mis issue jaoks tehti.

## Taust

- Haru nimi ja commit'i sõnum järgivad kokkulepitud kuju, et ajalugu oleks loetav.
- Pull request (PR) on koht, kus muudatust vaadatakse enne `master`-isse jõudmist. Kirjeldusse `Closes #<nr>` sulgeb issue automaatselt, kui PR liidetakse.
- PR mall tuletab meelde, mida enne liitmist kontrollida. 🟢 Frontendi repos on sama töövoog.

## Sammud

1. Lisa `.github/pull_request_template.md`:
   ```markdown
   ## Mis muutus

   Closes #

   ## Kuidas kontrollida

   1.

   ## Kontroll

   - [ ] `npm run lint` on puhas
   - [ ] `npm run format:check` on puhas
   - [ ] `npm run typecheck` on puhas
   - [ ] Proovisin käsitsi (brauser, Postman või `curl`)
   ```
2. Lepi kokku haru nimed ja commit'ide kuju:
   ```bash
   git switch -c feat/5-docker-postgres      # issue number + lühike nimi
   git commit -m "feat: postgres docker composes"
   ```
   | Eesliide | Millal |
   |---|---|
   | `feat:` | uus võimalus |
   | `fix:` | vea parandus |
   | `refactor:` | koodi ümberkorraldus ilma käitumist muutmata |
   | `chore:` | seadistus, paketid |
   | `docs:` | README, dokumentatsioon |
   | `test:` | testid |
3. Pull request:
   ```bash
   git push -u origin feat/5-docker-postgres
   gh pr create --fill
   ```
4. Kirjuta töövoog README-sse lühidalt (mõni lause + ülaltoodud tabel).
5. Commit selle issue enda muudatus eraldi harus `chore/4-too-voog`, tee sellest esimene PR ja liida see.

## Valmis, kui…

- [ ] PR mall on olemas
- [ ] README kirjeldab töövoogu ja eesliiteid
- [ ] See issue ise on tehtud PR-iga, mis sulges issue automaatselt
- [ ] Järgmine issue (#5) tehakse juba selle töövoo järgi

## Mida sa saavutasid

- **Nüüd töötab:** Tegid oma esimese pull requesti ja see sulges issue automaatselt.
- **Said selgeks:** Töövoog issue → haru → PR → merge ning commit'i eesliited (`feat:`, `fix:`, `chore:` ...).
- **Edasi:** Kõik järgmised sammud teed samamoodi: üks issue = üks haru = üks PR. Nii näed hiljem ajaloost, mis mille jaoks tehti.

## Materjalid

- [Conventional Commits](https://www.conventionalcommits.org/)
- [GitHub: Linking a pull request to an issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue)
- [GitHub CLI: gh pr create](https://cli.github.com/manual/gh_pr_create)

## Sõltub

- #3
