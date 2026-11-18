---
title: 30. Minu tellimused ja seeder: tellimused ja piletid
milestone: M6 – Tellimused
labels: api, suurus: M
---

## Eesmärk

Kasutaja näeb oma tellimusi koos piletitega (`GET /api/orders/me`). Seeder loob tellimused ja piletid nii, et `sold` klapib päris piletitega ja üks piletitüüp on välja müüdud.

## Taust

- **Ainult enda tellimused:** `userId` tuleb sessioonist (`req.user`), mitte URL-ist. `/api/orders/me`, mitte `/api/users/:id/orders`: nii ei saa keegi teise id-d proovida.
- **N+1 probleem:** naiivne lahendus teeb ühe päringu tellimustele ja siis **iga tellimuse kohta** ühe päringu piletitele. 50 tellimust = 51 päringut. Meie teeme **kaks**: tellimused, siis kõigi nende piletid korraga (`WHERE order_id IN (...)`), ja paneme koodis kokku.
- **Uuemad enne:** `orderBy(desc(createdAt))`. `id` teisena, et järjekord oleks alati sama.
- **Seeder ja `sold`:** `sold` peab võrduma `pending` + `active` piletite arvuga. Seepärast suurendab seeder `sold`-i iga tellimuse juures, mitte ei kirjuta seda juhuslikult. Aegunud tellimuse piletid on `cancelled` ja neid `sold`-i ei arvata.
- 🟢 Frontendi "Minu piletid ja QR-kood" leht kasutab seda route'i.

## Sammud

1. `order.repository.ts`:
   ```ts
   async findAllByUserId(userId: string): Promise<OrderWithTickets[]> {
       const orders = await this.db
           .select()
           .from(orderSchema)
           .where(eq(orderSchema.userId, userId))
           .orderBy(desc(orderSchema.createdAt), asc(orderSchema.id));

       if (orders.length === 0) {
           return [];
       }

       const tickets = await this.db
           .select()
           .from(ticketSchema)
           .where(
               inArray(
                   ticketSchema.orderId,
                   orders.map((order) => order.id),
               ),
           );

       return orders.map((order) => ({
           ...order,
           tickets: tickets.filter((ticket) => ticket.orderId === order.id),
       }));
   }
   ```
   `if (orders.length === 0)`: tühi `IN ()` oleks vigane SQL.
2. `order.service.ts`:
   ```ts
   async findMine(user: AuthUser): Promise<OrderWithTickets[]> {
       return this.orderRepository.findAllByUserId(user.id);
   }
   ```
3. `order.controller.ts`: `findMine` → `res.json(orders.map(toOrderResponse))`. `order.routes.ts`: `orderRouter.get("/me", orderController.findMine);`
4. Test: kaks ostjat ostavad, kumbki näeb ainult oma tellimust ja selle pileteid.
5. **Seeder.** `src/scripts/seed.ts`:
   - impordi `orderSchema`, `ticketSchema` ja tüübid `Ticket`, `TicketType`
   - #20-s salvesta ostjad muutujatesse: `const attendeeA = await createUser("Anu Ostja", ...)`, `const attendeeB = ...`
   - lisa funktsioonid (näiteks `buildEvent`-i järele):
   ```ts
   type SeedItem = {ticketType: TicketType; quantity: number};
   type SeedOrderStatus = "pending" | "paid" | "expired";

   async function createOrder(userId: string, eventId: string, items: SeedItem[], status: SeedOrderStatus) {
       const ticketStatus: Ticket["status"] = status === "paid" ? "active" : status === "pending" ? "pending" : "cancelled";
       const tickets = items.flatMap(({ticketType, quantity}) =>
           Array.from({length: quantity}, () => ({
               ticketTypeId: ticketType.id,
               priceCents: ticketType.priceCents,
               code: crypto.randomUUID(),
               status: ticketStatus,
           })),
       );
       const totalCents = tickets.reduce((sum, ticket) => sum + ticket.priceCents, 0);

       const [order] = await db.insert(orderSchema).values({userId, eventId, status, totalCents}).returning();
       if (!order) throw new UnexpectedError("Tellimust ei loodud");

       await db.insert(ticketSchema).values(tickets.map((ticket) => ({...ticket, orderId: order.id})));

       if (status !== "expired") {
           for (const {ticketType, quantity} of items) {
               await db
                   .update(ticketTypeSchema)
                   .set({sold: sql`${ticketTypeSchema.sold} + ${quantity}`})
                   .where(eq(ticketTypeSchema.id, ticketType.id));
           }
       }
   }
   ```
   - piletitüüpide järele leia üritused ja tüübid nime järgi ning loo tellimused:
   ```ts
   function eventByTitle(title: string) {
       const event = events.find((candidate) => candidate.title === title);
       if (!event) throw new UnexpectedError(`Üritust "${title}" pole`);
       return event;
   }

   function typeOf(eventTitle: string, name: string): TicketType {
       const event = eventByTitle(eventTitle);
       const ticketType = ticketTypes.find((candidate) => candidate.eventId === event.id && candidate.name === name);
       if (!ticketType) throw new UnexpectedError(`Piletitüüpi "${name}" pole`);
       return ticketType;
   }

   const rock = eventByTitle("Rokiõhtu");
   const jazz = eventByTitle("Jazzi õhtu");
   const tonight = eventByTitle("Elektroonilise muusika öö");
   const opera = eventByTitle("Ooperigala");

   // Rokiõhtu VIP on välja müüdud (10/10)
   await createOrder(attendeeA.id, rock.id, [{ticketType: typeOf("Rokiõhtu", "VIP"), quantity: 4}], "paid");
   await createOrder(attendeeB.id, rock.id, [{ticketType: typeOf("Rokiõhtu", "VIP"), quantity: 6}], "paid");
   await createOrder(attendeeA.id, rock.id, [{ticketType: typeOf("Rokiõhtu", "Tavapilet"), quantity: 2}], "paid");
   // Täna õhtul: kehtivad piletid skännimiseks (#40)
   await createOrder(attendeeA.id, tonight.id, [{ticketType: typeOf("Elektroonilise muusika öö", "Tavapilet"), quantity: 2}], "paid");
   // Makse ootel ja aegunud tellimus
   await createOrder(attendeeB.id, jazz.id, [{ticketType: typeOf("Jazzi õhtu", "Tavapilet"), quantity: 2}], "pending");
   await createOrder(attendeeA.id, jazz.id, [{ticketType: typeOf("Jazzi õhtu", "VIP"), quantity: 1}], "expired");
   // Möödunud üritus
   await createOrder(attendeeA.id, opera.id, [{ticketType: typeOf("Ooperigala", "Tavapilet"), quantity: 2}], "paid");

   if (realUserEmail) {
       const [realUser] = await db.select().from(user).where(eq(user.email, realUserEmail));
       if (realUser) {
           await createOrder(realUser.id, rock.id, [{ticketType: typeOf("Rokiõhtu", "Tavapilet"), quantity: 2}], "paid");
           await createOrder(realUser.id, tonight.id, [{ticketType: typeOf("Elektroonilise muusika öö", "VIP"), quantity: 1}], "paid");
       }
   }
   ```
   - `Ticket["status"]` tüüp on vajalik: muidu peab TypeScript `ticketStatus`-t objekti sees tavaliseks `string`-iks ja andmebaas lubab ainult nelja väärtust.
   - Päris kasutaja saab piletid, et "Minu piletid" lehel oleks midagi näha ja tühistamist (#34) saaks proovida.
6. Kontrolli:
   ```bash
   npm run seed -- sinu@gmail.com
   ```
   - Studio: Rokiõhtu VIP `sold = 10`, `capacity = 10`
   - `curl localhost:3000/api/public/events/<rokiõhtu id>/ticket-types`: VIP `available: 0`
   - testlehe konsoolist `fetch("/api/orders/me")`: sinu 2 tellimust
   - proovi osta Rokiõhtu VIP-i → `409`
   - käivita seeder teist korda: tulemus on sama

## Valmis, kui…

- [ ] `GET /api/orders/me` näitab ainult enda tellimusi koos piletitega, kahe päringuga
- [ ] Seederis on makstud, ootel ja aegunud tellimus ning välja müüdud piletitüüp
- [ ] Iga piletitüübi `sold` võrdub selle `pending` + `active` piletite arvuga
- [ ] Testid on rohelised

## Mida sa saavutasid

- **Nüüd töötab:** Kasutaja näeb oma tellimusi koos piletitega ja seederis on erinevate olekutega tellimused.
- **Said selgeks:** Seotud andmete laadimine ilma N+1 päringuta ja andmete kooskõla (`sold` = päris piletite arv).
- **Edasi:** Siiani oli makse "kohe tehtud". Järgmine verstapost lisab päris makse.

## Kontrollküsimused

1. **Mis on N+1 probleem?** Üks päring nimekirjale + üks iga rea kohta. Meie teeme kaks päringut kokku.
2. **Miks `/api/orders/me`, mitte `/api/users/:id/orders`?** Kasutaja id tuleb sessioonist, teise id-d ei saa proovida.
3. **Miks seeder suurendab `sold`-i tellimuse kaupa, mitte ei kirjuta juhuslikku arvu?** `sold` peab klappima päris piletitega.

## Materjalid

- [Drizzle: inArray](https://orm.drizzle.team/docs/operators#inarray)
- [What is the N+1 query problem](https://stackoverflow.com/questions/97197/what-is-the-n1-selects-problem-in-orm-object-relational-mapping)

## Sõltub

- #28
