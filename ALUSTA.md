# Alusta siit

Ehitad piletirakenduse backend'i 48 sammuga. Iga samm on üks issue.

## 1. Tee oma repo

**Use this template** → **Create a new repository** → omanik sina → **Create repository**.

## 2. Loo issued

1. Oma repos ava fail `.github/workflows/seadista-issued.yml` → ✏️ → lisa lõppu tühi rida → **Commit changes**. (Ilma selleta GitHub workflow'd ei näe.)
2. **Actions** → **Seadista issued** → **Run workflow**. Oota ~2 min.

Tee see enne esimest pull requesti, siis on issue number = sammu number.

## 3. Klooni

```bash
git clone git@github.com:<sinu-kasutaja>/<repo-nimi>.git
```

## 4. Vaja on

Node.js 22+, Git, Docker Desktop, GitHub CLI (`gh`), koodiredaktor.

## 5. Tööjärjekord

1. Ava järgmine issue (alusta #1-st).
2. Tee **Sammud** läbi.
3. Kontrolli **Valmis, kui…** linnukesed.
4. Loe **Mida sa saavutasid**. Kas oskad seda oma sõnadega seletada?
5. Vasta **Kontrollküsimustele** enne vastust lugemata.
6. Sulge issue: sammud 1–3 käsitsi, alates 4. sammust PR-iga (`Closes #<nr>`).

Kinni jäid? Kirjuta issue alla, mida proovisid ja mis viga said.
