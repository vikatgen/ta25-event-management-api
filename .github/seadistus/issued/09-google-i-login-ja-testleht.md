---
title: 9. Google'i login ja testleht
milestone: M1 – Sisselogimine
labels: api, suurus: M
---

## Eesmärk

Kasutaja vajutab nuppu "Logi sisse Google'iga", logib Google'is sisse ja tuleb tagasi meie lehele sisselogituna. Andmebaasis on tema `user`, `account` ja `session` rida.

## Taust

**OAuth:** me ei näe kunagi kasutaja Google'i parooli. Google ütleb meile "see on kasutaja X" ja Better Auth loob või leiab meie andmebaasist kasutaja.

```
Brauser ──POST /api/auth/sign-in/social──► meie server ──► vastus: Google'i URL
Brauser ─────────────────────────────────► Google (kasutaja logib sisse)
Google ──redirect /api/auth/callback/google──► meie server (Better Auth loob user + account + session)
meie server ──redirect "/" + cookie──► Brauser (sisse logitud)
```

- **Miks POST + `fetch`, mitte lihtsalt link?** POST kaitseb selle eest, et keegi teine leht ei saaks sinu nimel sisselogimist käivitada. Vastuses on Google'i aadress, kuhu brauseri suuname.
- Sessioon elab **`HttpOnly` cookie's**: JavaScript ei saa seda lugeda, seega XSS rünnak ei saa sessiooni varastada.
- 🟢 Frontendis tegid sama nupu Reactis. Siin teeme lihtsa testlehe otse backendi `public/` kausta, et sisselogimist saaks proovida ilma frontendita.

## Sammud

1. **Google Cloud Console** (igaüks oma kontoga):
   1. APIs & Services → Credentials → **Create OAuth client ID** → Web application
   2. **Authorized redirect URI:** `http://localhost:3000/api/auth/callback/google`
   3. OAuth consent screen: testrežiimis lisa oma konto *Test users* alla
   4. Kopeeri **Client ID** ja **Client secret**

   > ⚠️ Redirect URI peab olema **täpselt** sama (port, `http`, kaldkriips). Muidu tuleb viga `redirect_uri_mismatch`.
2. `.env` (väärtustega) ja `.env.example` (tühjalt): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
   `src/config/env.ts`:
   ```ts
   GOOGLE_CLIENT_ID: z.string().min(1),
   GOOGLE_CLIENT_SECRET: z.string().min(1),
   ```
   `min(1)`, sest tühi rida `GOOGLE_CLIENT_ID=` läbiks muidu kontrolli ja viga tuleks alles sisselogimisel.
3. `src/auth/auth.ts`, lisa `database` rea järele:
   ```ts
   socialProviders: {
       google: {
           clientId: env.GOOGLE_CLIENT_ID,
           clientSecret: env.GOOGLE_CLIENT_SECRET,
       },
   },
   ```
   See on kõik: Better Auth teab ise Google'i aadresse ja oskab profiili lugeda.
4. `src/app.ts`, `express.json()` järele:
   ```ts
   app.use(express.static("public"));
   ```
5. `public/index.html`:
   ```html
   <!doctype html>
   <html lang="et">
   <head>
       <meta charset="utf-8">
       <title>Sisselogimise test</title>
   </head>
   <body>
       <button id="google">Logi sisse Google'iga</button>
       <pre id="session"></pre>
       <script src="/app.js"></script>
   </body>
   </html>
   ```
   Skript on eraldi failis, mitte `<script>...</script>` sees. Hiljem (#41) keelab turvapäis inline-skriptid, nii et teeme kohe õigesti.
6. `public/app.js`:
   ```js
   document.getElementById("google").onclick = async () => {
       const res = await fetch("/api/auth/sign-in/social", {
           method: "POST",
           headers: {"Content-Type": "application/json"},
           body: JSON.stringify({provider: "google", callbackURL: "/"}),
       });
       const data = await res.json();
       window.location.href = data.url;
   };

   fetch("/api/auth/get-session")
       .then((res) => res.json())
       .then((data) => (document.getElementById("session").textContent = JSON.stringify(data, null, 2)));
   ```
   - `callbackURL: "/"`: kuhu kasutaja **pärast** sisselogimist tagasi suunatakse.
   - `GET /api/auth/get-session` on Better Authi enda route: tagastab sessiooni või `null`.
7. Kontrolli:
   1. `npm run server`, ava http://localhost:3000 → näed `null`
   2. Vajuta nuppu → Google → tagasi → näed oma andmeid, sh `role: "attendee"`
   3. Studio: `user`, `account` (`provider_id = google`) ja `session` tabelis on igaühes 1 rida
   4. Logi uuesti sisse → `user` tabelisse **ei tule** uut rida
   5. DevTools → Application → Cookies → `better-auth.session_token` on `HttpOnly`

## Valmis, kui…

- [ ] Google'iga sisselogimine töötab ja testleht näitab sessiooni
- [ ] Teine sisselogimine ei loo uut kasutajat
- [ ] Sessiooni cookie on `HttpOnly`
- [ ] Google'i võtmed on ainult `.env`-is, mitte gitis

## Mida sa saavutasid

- **Nüüd töötab:** Saad Google'iga sisse logida ja testleht näitab sinu sessiooni.
- **Said selgeks:** OAuth: parooli ei näe me kunagi, Google ütleb meile, kes kasutaja on. Sessiooni cookie on `HttpOnly`, nii et JavaScript seda ei loe.
- **Edasi:** Sama mustriga lisad järgmises sammus GitHubi.

## Kontrollküsimused

1. **Kas meie server näeb kasutaja Google'i parooli?** Ei: parool sisestatakse Google'i lehel.
2. **Miks peab redirect URI olema täpselt sama?** Google saadab koodi ainult registreeritud aadressile, muidu saaks ründaja selle enda serverisse suunata.
3. **Miks teisel sisselogimisel uut kasutajat ei tekkinud?** Better Auth leidis `account` tabelist rea (`google` + Google'i id).

## Materjalid

- 📖 [M6 › OAuth: logi sisse Google'iga](https://vikatgen.github.io/oppematerjalid/veebirakendused/backend/10-oauth): ümbersuunamised, ühekordne kood, state, client secret
- [Better Auth: Google](https://www.better-auth.com/docs/authentication/google)
- [Google: Using OAuth 2.0](https://developers.google.com/identity/protocols/oauth2)
- [MDN: HttpOnly cookies](https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#restrict_access_to_cookies)

## Sõltub

- #8
