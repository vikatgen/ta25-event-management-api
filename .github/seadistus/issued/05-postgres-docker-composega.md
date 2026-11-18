---
title: 5. Postgres Docker Composega
milestone: M0 – Projekti algus
labels: seadistus, suurus: S
---

## Eesmärk

Arvutis töötab PostgreSQL andmebaas Dockeri konteineris, mida käivitad ja peatad ühe käsuga.

## Taust

- **PostgreSQL** on andmebaas, kuhu salvestame üritused, tellimused ja piletid. 🟢 Frontendis andmeid ei hoidnud: need tulid API-st. Nüüd oleme API poolel.
- **Docker Compose** kirjeldab teenused failis (`docker-compose.yaml`). Nii ei pea Postgresi oma arvutisse paigaldama ja kõigil on sama versioon.
- **Andmed peavad säilima.** Konteiner kustub, kui sa selle eemaldad. Seepärast on andmed eraldi **volume'is** (`pgdata`), mis jääb alles ka siis, kui konteiner kustutada.
- **Parool ei kuulu koodi.** Kasutaja, parool ja andmebaasi nimi tulevad `.env` failist. `.env` ei lähe gitti (see on juba `.gitignore`-is), aga **`.env.example` läheb**: see näitab, milliseid muutujaid vaja on, ilma päris väärtusteta.

## Sammud

1. Kontrolli, et Docker töötab: `docker --version` ja `docker compose version`.
2. `docker-compose.yaml`:
   ```yaml
   name: "event-management-api"
   services:
     postgres:
       image: postgres:16-alpine
       container_name: postgres-database
       environment:
         POSTGRES_USER: ${DATABASE_USER}
         POSTGRES_PASSWORD: ${DATABASE_PASSWORD}
         POSTGRES_DB: ${DATABASE_NAME}
       ports:
         - "127.0.0.1:5432:5432"
       volumes:
         - pgdata:/var/lib/postgresql/data

   volumes:
     pgdata:
   ```
   - `127.0.0.1:5432:5432`: baas on kättesaadav ainult sinu arvutist, mitte kogu võrgust.
   - `${DATABASE_USER}`: Compose loeb väärtused `.env` failist.
3. `.env` (sinu oma, ei lähe gitti):
   ```
   DATABASE_USER=app
   DATABASE_PASSWORD=mõtle-oma-parool
   DATABASE_NAME=events
   ```
4. `.env.example` (läheb gitti, **ilma väärtusteta**):
   ```
   DATABASE_USER=
   DATABASE_PASSWORD=
   DATABASE_NAME=
   ```
5. Käivita ja kontrolli:
   ```bash
   docker compose up -d
   docker compose ps
   docker compose exec postgres psql -U app -d events -c "SELECT version();"
   ```
   (`-U` ja `-d` väärtused on sinu `.env`-ist.)
6. Proovi, et andmed säilivad: `docker compose down` ja uuesti `docker compose up -d`. Alles jäävad. **`docker compose down -v` kustutab andmed**: kasuta seda ainult siis, kui tahad päris puhast baasi.
7. Lisa README käskude tabelisse `docker compose up -d` ja `docker compose down`.
8. Commit:
   ```bash
   git add docker-compose.yaml .env.example README.md
   git commit -m "feat: postgres docker composes"
   ```
   Kontrolli `git status`: `.env` **ei tohi** olla commit'is.

## Valmis, kui…

- [ ] `docker compose ps` näitab konteinerit olekus `running`
- [ ] `psql` käsk tagastab Postgresi versiooni
- [ ] `.env` pole gitis, `.env.example` on
- [ ] README käskude tabel on täiendatud

## Mida sa saavutasid

- **Nüüd töötab:** Sinu arvutis töötab Postgres Dockeri konteineris, mida käivitad ja peatad ühe käsuga.
- **Said selgeks:** Mis on konteiner, miks andmebaasi ei paigaldata otse arvutisse ja miks `.env` ei lähe gitti (aga `.env.example` läheb).
- **Edasi:** Järgmised kaks sammu ühendavad rakenduse selle andmebaasiga.

## Materjalid

- 📖 [M6 › Andmebaas ja seosed](https://vikatgen.github.io/oppematerjalid/veebirakendused/backend/05-andmebaas-ja-seosed): tabelid, primaar- ja võõrvõti, üks-mitmele ja mitu-mitmele, cascade vs restrict, check
- 📖 [M6 › Konfiguratsioon ja saladused](https://vikatgen.github.io/oppematerjalid/veebirakendused/backend/14-konfiguratsioon): keskkonnamuutujad, .env vs .env.example, 12 faktorit, kontroll käivitamisel
- [Docker Compose: Getting started](https://docs.docker.com/compose/gettingstarted/)
- [Docker Hub: postgres image](https://hub.docker.com/_/postgres)

## Sõltub

- #1
