---
title: 14. Ürituse DTO-d: mida klient saadab ja mida server tagastab
milestone: M3 – Üritused
labels: api, suurus: M
---

## Eesmärk

On kirjas, **mida klient tohib saata** (loomise DTO zod skeemina) ja **mida server tagastab** (vastuse DTO). Kuupäevade loogika (lõpp pärast algust jne) on kontrollitud enne, kui midagi andmebaasi jõuab.

## Taust

**DTO** (Data Transfer Object) = andmete kuju, mis liigub üle võrgu. Tabeli rida ja DTO on **erinevad asjad**:

| | Tabeli rida (`Event`) | Loomise DTO | Vastuse DTO |
|---|---|---|---|
| `id`, `status`, ajatemplid | ✅ | ❌ server paneb ise | ✅ |
| `organizerId` | ✅ | ❌ tuleb sisselogitud kasutajalt | ✅ |
| kuupäevad | `Date` | ISO string → `Date` | `Date` → ISO string |

- Kui loomise DTO-s oleks `organizerId`, saaks igaüks luua ürituse teise korraldaja nimele. Kui seal oleks `status`, saaks mustandi vahele jätta.
- **Zod** kontrollib päringu keha. `parse` viskab `ZodError`-i, mille `errorHandler` (#12) teeb `400`-ks koos väljade vigadega.
- **`.refine`** on kontroll, mis vaatab mitut välja korraga ("lõpp pärast algust"). `path` ütleb, millise välja juurde viga kuulub.
- **Kuupäevad:** klient saadab ISO stringi koos ajavööndiga (`"2026-11-01T17:00:00.000Z"`), meie teeme sellest `Date`-i. Vastuses vastupidi: `toISOString()`.
- 🟢 Frontendis oli `EventForm` vorm ja `<FieldError field="endsAt">`. Need sõnumid tulevad siit.

## Sammud

1. `src/shared/validation/iso-date-time.helper.ts`:
   ```ts
   import z from "zod";

   export const isoDateTime = z.iso.datetime({offset: true}).transform((value) => new Date(value));
   ```
   `offset: true` lubab ka `+02:00` kuju, mitte ainult `Z`-i. Teeme selle eraldi faili, sest sama on vaja ka hiljem.
2. `src/event/dto/create-event.dto.ts`:
   ```ts
   import z from "zod";
   import {isoDateTime} from "../../shared/validation/iso-date-time.helper.js";

   export const createEventDto = z
       .object({
           title: z.string().min(1).max(255),
           description: z.string().min(1),
           shortDescription: z.string().min(1).max(500),
           imageUrl: z.url().max(500).optional(),
           locationName: z.string().min(1).max(255),
           address: z.string().min(1).max(255),
           city: z.string().min(1).max(100),
           startsAt: isoDateTime,
           endsAt: isoDateTime,
           salesStartAt: isoDateTime,
           salesEndAt: isoDateTime,
       })
       .refine((dto) => dto.endsAt > dto.startsAt, {
           message: "Üritus peab lõppema pärast algust",
           path: ["endsAt"],
       })
       .refine((dto) => dto.salesEndAt <= dto.endsAt, {
           message: "Müük ei saa kesta kauem kui üritus",
           path: ["salesEndAt"],
       })
       .refine((dto) => dto.salesStartAt < dto.salesEndAt, {
           message: "Müük peab lõppema pärast algust",
           path: ["salesEndAt"],
       });

   export type CreateEventDto = z.infer<typeof createEventDto>;
   ```
   - Pikkuse piirid (`max(255)`) on samad mis tabelis: muidu jõuaks liiga pikk tekst andmebaasi ja annaks `500`.
   - `z.infer`: tüüp tuleb skeemist, seda ei kirjuta käsitsi.
3. `src/event/dto/event-response.dto.ts`:
   ```ts
   import type {Event, EventStatusEnum} from "../../db/schema/event.schema.js";

   export type EventResponseDto = {
       id: string;
       title: string;
       description: string;
       shortDescription: string;
       imageUrl: string | null;
       locationName: string;
       address: string;
       city: string;
       startsAt: string;
       endsAt: string;
       salesStartAt: string;
       salesEndAt: string;
       organizerId: string;
       status: EventStatusEnum;
       createdAt: string;
       updatedAt: string;
   };

   export function toEventResponse(event: Event): EventResponseDto {
       return {
           id: event.id,
           title: event.title,
           description: event.description,
           shortDescription: event.shortDescription,
           imageUrl: event.imageUrl,
           locationName: event.locationName,
           address: event.address,
           city: event.city,
           startsAt: event.startsAt.toISOString(),
           endsAt: event.endsAt.toISOString(),
           salesStartAt: event.salesStartAt.toISOString(),
           salesEndAt: event.salesEndAt.toISOString(),
           organizerId: event.organizerId,
           status: event.status,
           createdAt: event.createdAt.toISOString(),
           updatedAt: event.updatedAt.toISOString(),
       };
   }
   ```
   Väljad on loetletud ükshaaval, mitte `{...event}`. Kui tabelisse lisandub hiljem sisemine väli, ei lähe see kogemata kliendile (sama mõte nagu `toMeResponse` #11-s).
4. Proovi skeemi ilma serverita. Loo ajutine fail `try-dto.ts` projekti juurkausta:
   ```ts
   import {createEventDto} from "./src/event/dto/create-event.dto.js";

   const result = createEventDto.safeParse({
       title: "Proov",
       startsAt: "2026-11-01T19:00:00+02:00",
       endsAt: "2026-11-01T18:00:00+02:00",
   });
   console.log(result.success ? result.data : result.error.issues);
   ```
   `npx tsx try-dto.ts`: millised vead tulid? Paranda andmeid, kuni `success` on `true`. **Kustuta fail.**

## Valmis, kui…

- [ ] Vigane kuupäevade järjekord annab sõnumi õige välja juures
- [ ] Puuduvad väljad annavad vea, `imageUrl` võib puududa
- [ ] `npm run typecheck` on puhas ja ajutine fail on kustutatud

## Mida sa saavutasid

- **Nüüd töötab:** On kirjas, mida klient tohib saata ja mida server tagastab, ja vigased kuupäevad peatatakse enne andmebaasi.
- **Said selgeks:** DTO on leping kliendiga. Sisend ja väljund on eri kujuga, sest kõiki välju ei tohi klient määrata ega näha.
- **Edasi:** Järgmises sammus kasutab neid DTO-sid service.

## Kontrollküsimused

1. **Miks loomise DTO-s pole `organizerId`-d?** Muidu saaks luua ürituse teise inimese nimele.
2. **Miks vastuse DTO loetleb väljad, mitte ei tee `{...event}`?** Uued sisemised väljad ei leki kogemata.
3. **Miks `.refine`, mitte iga välja juures kontroll?** Kontroll vajab mitut välja korraga.

## Materjalid

- 📖 [M6 › DTO: mis tohib sisse ja välja minna?](https://vikatgen.github.io/oppematerjalid/veebirakendused/backend/03-dto): sisend- ja väljund-DTO, valideerimine vs äriloogika
- [Zod: Refinements](https://zod.dev/api#refinements)
- [Zod: ISO datetimes](https://zod.dev/api#iso-datetimes)

## Sõltub

- #12
- #13
