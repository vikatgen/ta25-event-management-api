# Piletirakenduse backend

Tegemist on REST API rakendusega, mis kasutab DI, Repository pattern, DTO, valideerimine, SSO autentimist jpm.
Rakendus ehitatakse ülesse ticketite kaupa, kus iga ticket viib rakenduse järgmisesse staatusesse.
Iga ticket sõltub varasemast ning tehakse järjekorras.

#### Käivitamine
`npm install` teekide paigaldamine

`npm run start` serveri käivitamine

Projekti kaustastruktuur
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
