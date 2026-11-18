---
title: 10. GitHubi login
milestone: M1 – Sisselogimine
labels: api, suurus: S
---

## Eesmärk

Lisaks Google'ile saab sisse logida ka GitHubiga. Sama inimene võib kasutada mõlemat.

## Taust

- Better Authis on iga sisselogimisviis (provider) üks plokk `socialProviders` sees. Uus provider = uus võti ja uued keskkonnamuutujad, ülejäänud kood ei muutu.
- Iga provider loob `account` tabelisse oma rea (`provider_id = "github"`). `user` rida on üks.
- **Kontode sidumine:** kui Google'i ja GitHubi e-post on sama, seob Better Auth need sama kasutajaga ainult siis, kui provider kinnitab, et e-post on kontrollitud. Muidu tekib eraldi kasutaja. See on turvaline vaikimisi käitumine: muidu saaks keegi teha GitHubi konto sinu e-postiga ja pääseks sinu kontole.

## Sammud

1. **GitHub:** Settings → Developer settings → OAuth Apps → **New OAuth App**
   - Homepage URL: `http://localhost:3000`
   - **Authorization callback URL:** `http://localhost:3000/api/auth/callback/github`
   - Kopeeri **Client ID**, genereeri **Client secret**
2. `.env` (väärtustega) ja `.env.example` (tühjalt): `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`.
   `src/config/env.ts`:
   ```ts
   GITHUB_CLIENT_ID: z.string().min(1),
   GITHUB_CLIENT_SECRET: z.string().min(1),
   ```
3. `src/auth/auth.ts`, `socialProviders` sisse Google'i järele:
   ```ts
   github: {
       clientId: env.GITHUB_CLIENT_ID,
       clientSecret: env.GITHUB_CLIENT_SECRET,
   },
   ```
4. `public/index.html`: lisa nupp `<button id="github">Logi sisse GitHubiga</button>`.
5. `public/app.js`: kaks nuppu teevad sama asja, ainult `provider` erineb. Tee sellest üks funktsioon:
   ```js
   async function signIn(provider) {
       const res = await fetch("/api/auth/sign-in/social", {
           method: "POST",
           headers: {"Content-Type": "application/json"},
           body: JSON.stringify({provider, callbackURL: "/"}),
       });
       const data = await res.json();
       window.location.href = data.url;
   }

   document.getElementById("google").onclick = () => signIn("google");
   document.getElementById("github").onclick = () => signIn("github");
   ```
6. Kontrolli:
   1. Logi sisse GitHubiga → testleht näitab sessiooni
   2. Studio: `account` tabelis on rida `provider_id = github`
   3. Vaata, kas sinu Google'i ja GitHubi kontod läksid sama `user_id` alla või tekkis kaks kasutajat. Miks?

## Valmis, kui…

- [ ] GitHubiga sisselogimine töötab
- [ ] `account` tabelis on `github` rida
- [ ] Testlehel on mõlemad nupud ja kood ei kordu

## Mida sa saavutasid

- **Nüüd töötab:** Sisse saab logida nii Google'i kui ka GitHubiga.
- **Said selgeks:** Üks kasutaja võib olla seotud mitme kontoga (`account` tabel). Uue teenusepakkuja lisamine on hea seadistuse korral paar rida.
- **Edasi:** Nüüd teame, kes on sisse loginud. Järgmine samm otsustab, kuhu ta pääseb.

## Materjalid

- 📖 [M6 › OAuth: logi sisse Google'iga](https://vikatgen.github.io/oppematerjalid/veebirakendused/backend/10-oauth): ümbersuunamised, ühekordne kood, state, client secret
- [Better Auth: GitHub](https://www.better-auth.com/docs/authentication/github)
- [GitHub: Creating an OAuth app](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app)
- [Better Auth: Account linking](https://www.better-auth.com/docs/concepts/users-accounts#account-linking)

## Sõltub

- #9
