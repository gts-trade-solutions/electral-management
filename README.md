# BallotRoute · Electoral Management System

Custody and transport tracking for electoral assets, the vehicles that carry them and
the people on board. Built for the South African Local Government Elections on
**4 November 2026**. The name, tagline and demo email domain are set in `lib/brand.ts`.

South Africa votes on **paper ballots**, so there are no voting machines here. The
tracked assets are:

- **VMDs** (Voter Management Devices): the handheld tablets that check a voter is at their registered voting district
- **Ballot boxes**
- **Ballot-paper consignments**

Every asset and vehicle carries an RFID tag, and everyone who works in the field carries
an RFID badge.

**Every person is a user.** They sign in, have a role (what they may do in the app), can
be assigned to a vehicle with a duty on it (driver, escort, electoral officer, SAPS
officer), and share their phone's location while signed in. Everything they do is
written to an activity log. The **People** screen shows who is on which vehicle, where
everyone is, and each person's trips, location trail and full activity.

This is a **frontend-only MVP**. There is no backend, database or Docker. Everything
runs in the browser, and data is saved to `localStorage`, so it survives reloads but
stays on the device that created it.

## Demo logins

**Office accounts**

| Name | Role | Email | Password | Can do (by default) |
|---|---|---|---|---|
| Thandeka Nkosi | ADMIN | `admin@ballotroute.test` | `Admin#2026` | Everything, including users, role permissions and alert settings |
| Johan Botha | COORDINATOR | `coordinator@ballotroute.test` | `Coord#2026` | Trips, vehicles and who is on them, tracking people, the simulator, acknowledging alerts |
| Sipho Dlamini | OFFICER | `officer@ballotroute.test` | `Officer#2026` | Scanning assets and recording hand-offs (warehouse officer at City Deep) |

**Field accounts**, all with the password `Field#2026`. Each email is
`firstname.lastname@ballotroute.test`, for example `kagiso.molefe@ballotroute.test`.

| Vehicle | People on it |
|---|---|
| FT 08 RX GP (in transit to Sebokeng) | Kagiso Molefe (driver), Thabo Mokoena (escort), Zanele Dube (SAPS officer) |
| CP 77 WD GP (planned to Mamelodi East) | Nomsa Mahlangu (driver), Ruan de Villiers (electoral officer) |
| JK 21 LM GP (available) | Mandla Zulu (driver), Busisiwe Mthembu (electoral officer) |
| TKD 482 GP (out of service) | Pieter Joubert (driver) |
| Not on a vehicle | Ayanda Khumalo (crew), Lerato Ndlovu (presiding officer, Orlando West) |

Drivers, escorts and SAPS officers have the CREW role. Electoral officers and the
presiding officer have the OFFICER role, so they can record hand-offs.

The sign-in page has one-click buttons for every active account. On the **Admin**
screen an admin can:
- add accounts, including putting someone straight onto a vehicle
- change a person's role
- deactivate an account (which takes them off their vehicle)
- choose what coordinators, officers and crew may do
- set the alert limits

Accounts are checked in the browser: this is a role switcher for demos, not security.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:3000. On the first visit the demo data is generated in your
browser. **Reset demo data** in the user menu (top right) starts over.

## Deploy to Vercel

No environment variables or settings are needed.

**From GitHub**
1. Push this folder to a GitHub repository.
2. Go to [vercel.com/new](https://vercel.com/new) and import the repository.
3. Click **Deploy**. Vercel detects Next.js automatically.

**From the command line**
```bash
npx vercel          # log in and create a preview deployment
npx vercel --prod   # promote to production
```

GPS capture and camera scanning need HTTPS. Vercel provides it, and so does `localhost`.

## The screens

| Screen | What it shows |
|---|---|
| **Map** | Live trips, planned routes with their 2 km corridor, and each vehicle's position with crew and asset counts from its RFID reader. Also: pins where each alert happened, the open alerts, and the GPS and RFID simulator. |
| **Assets** | Every asset. Click a location to see it on the map, or click a row for its custody chain and a small map of every scan. |
| **Trips** | Create a trip, pick its assets, load them, dispatch, receive, and close. Closing checks the manifest. |
| **Vehicles** | Each vehicle and where it is, with:<br>- the people assigned to it, by name and duty, each shown as on board or not (RFID badge) and near or away from it (phone)<br>- which assets are on board, detected by their tags<br>- the RFID activity log<br>Add vehicles, assign or move people, or take a vehicle out of service. |
| **People** | For admins and coordinators:<br>- **who is on which vehicle**, with the number of members and seats<br>- a map of where everyone is<br>- a table of everyone, with their vehicle, where they are now, when they were last seen and their last action<br>- the activity log of everything anyone did<br><br>Click a person to see their location trail, their vehicle and crewmates, their trips, and a timeline of everything they did, everything done to them, RFID reads of their badge and alerts about them. Everyone can open their own page from the user menu. |
| **Scan** | Mobile-first hand-offs: type or scan a serial, choose the hand-off, confirm the seal. |
| **Alerts** | Every alert: acknowledge it, open it on the map, or open the person it's about. |
| **Admin** | Users and their vehicles, role permissions and alert settings. Admins only. |

The header shows whether this device is sharing its location. It's on by default for
field staff and off for office staff, and anyone can switch it.

## Demo script

Signing in as **Admin** lets you do every step without switching accounts.

**1. Load 10, dispatch, watch it move, receive 9. Closure is blocked.**
1. **Trips** → the *Planned* trip `CP 77 WD GP → Mamelodi East Primary School`. Its 10 assets are already picked.
2. **Load onto CP 77 WD GP**: enter a seal number such as `SL-300001`, then click **Load 10**.
   Allow location access. With no GPS fix, use the flagged facility-location fallback.
3. Click **Dispatch**. The vehicle's RFID reader now counts 2 crew and 10 assets on board.
4. **Map** → **GPS and RFID simulator**: choose `CP 77 WD GP`, **On route**, **Start**.
5. When it arrives: **Trips** → **Receive**, untick one asset, **Receive 9** → **Close trip**.
   Closure is **blocked** and a **Manifest mismatch** alert is raised.

**2. Any asset shows its full custody chain.** Open **Assets** and click a row. The
drawer shows a map of every scan, and each hand-off lists:
- who recorded it and who held the asset afterwards
- the GPS position of the scan (click it to open the map)
- the seal number
- the time, in SAST

Click a **location** in the table to see that facility or vehicle on the main map.

**3. Off route → deviation alert.** On the **Map**, start the simulator on the in-transit
`FT 08 RX GP → Sebokeng` trip with **Off route**. A **Route deviation** alert appears on
the map, pinned where it happened.

**4. Unusual activity on the road.** First go to **Admin** and set **Unscheduled stop
after** to `0.5` minutes, so you don't wait long. Then, while the simulator is running:
- **Step out** on a crew member raises **Crew left vehicle**: their badge stopped being read away from any facility.
- **Lose tag** on an asset raises **Asset not detected**: a loaded asset's tag went quiet in transit.
- **Stop the vehicle** raises **Unscheduled stop** after 30 seconds of standing still.
- **Back in**, **Tag found** and **Drive on** undo each one.

Open **Vehicles** to see the on-board counts drop and each event in the RFID log.

**5. Roles.** On **Admin**, untick *Record hand-offs* for officers, then sign in as the
officer: the Scan screen no longer lets them record. Tick *Dispatch trips* and officers
can dispatch.

**6. Who is on which vehicle, and tracking people.**
1. Open **People**. *Who is on which vehicle* shows each vehicle's members and seats. The
   map shows where everyone's phone is.
2. Click **Kagiso Molefe**. You see his location trail, his vehicle and crewmates, his
   trips, and every sign-in, assignment and alert about him.
3. Open **Ayanda Khumalo**, choose **Assign to** `JK 21 LM GP` with duty **Escort**, and
   click **Save**. Vehicles, People and Admin all show her on JK 21 LM GP, and the
   activity log records who assigned her.
4. Start the simulator on a trip and click **Step out** on a crew member. Their badge
   stops being read (**Crew left vehicle**), and their phone walks away from the vehicle.
   Once it is more than 100 m away, **Crew away from vehicle** is raised. On the map they
   appear in red with a dashed line back to their vehicle, and **People** lists them under
   *Away from their vehicle*.

## The rules

| Rule | What it does | Where |
|---|---|---|
| Custody is append-only | No function edits or deletes a custody event, and each one is frozen. Every record stores the GPS of the scan. | `lib/domain.ts` |
| Manifest reconciliation | Closing a trip compares what was loaded with what was received. Any difference blocks closure and raises **Manifest mismatch**. There is no override. | `lib/rules.ts` |
| Route deviation | Every GPS ping is checked with `turf.pointToLineDistance`. More than 2 km off the route raises **Route deviation**, once per excursion. | `lib/rules.ts` |
| Unscheduled stop | Standing still (within 50 m) for longer than the admin's limit raises it, once per stop. It doesn't apply within 300 m of the origin or destination, and a gap of more than 90 s in the pings breaks the stop. | `lib/rules.ts` |
| Crew left vehicle | The in-cab reader stops seeing a crew badge away from the origin and destination. | `lib/domain.ts` |
| Crew away from vehicle | A crew member's phone is further from their vehicle than the admin's limit (100 m by default) while the vehicle is on the road. At the origin or destination, they may move within 300 m. It's raised once per excursion. | `lib/rules.ts` |
| Activity log | Every command records who did it, when, and where their phone was. Entries are never edited or deleted. | `lib/domain.ts` |
| Who is on which vehicle | A duty is required, seats are enforced, each vehicle has at most one driver, and nobody joins or leaves a vehicle while it's on the road. | `lib/domain.ts` |
| Asset not detected | The reader stops seeing a loaded asset's tag while in transit. | `lib/domain.ts` |
| Driver required | A trip can't be dispatched until its vehicle has a driver. | `lib/domain.ts` |

These are pure functions, and the seed, simulator and screens all use the same code.
Each rule was tested against the acceptance criteria, and every role and validation
rule was tested too, before the UI was built.

## Seed data

| | |
|---|---|
| Facilities | IEC Warehouse, City Deep (Johannesburg), plus 8 voting stations across Johannesburg, Tshwane, Ekurhuleni and Emfuleni: schools, halls, churches and one temporary tent |
| Assets | 40 VMDs, 10 ballot boxes and 10 ballot-paper consignments, each with an RFID tag |
| Vehicles | 4 Gauteng plates, each with a windscreen tag and an in-cab reader. One is out of service. |
| People | 13 users:<br>- 3 office staff<br>- 8 people assigned to the 4 vehicles<br>- 1 crew member not yet assigned<br>- 1 presiding officer<br><br>Each has a recent phone location, and there's a 24-entry activity log of who did what. Phone numbers are fictitious. |
| Trips | **Closed**: to Orlando West, six days ago, with an acknowledged protest detour.<br>**In transit**: to Sebokeng, with 3 crew and 10 assets on board.<br>**Planned**: to Mamelodi East, with 10 assets picked. |

## What the MVP does not do

- **No sharing between devices.** Data lives in one browser. Two tabs in the same
  browser stay in sync, but a phone and a laptop don't. A real deployment needs an API
  and a database.
- **Tracking people across devices needs that backend too.** A field worker's phone
  records their location, but only in that phone's browser. The office can't see it
  until the data is shared through a server. In the demo, the simulator stands in for
  the crew's phones. Everything else, including the alert rules, the People screen and
  the activity log, already works from the data and will work unchanged once real
  phones report to a server.
- **GPS and RFID are simulated.** There's no tracker or RFID hardware: the simulator
  sends what they would. The data model, including reader snapshots and gate reads, is
  shaped for real devices to feed later.
- **Demo sign-in only.** Passwords are stored and checked in the browser.
- **GPS fallback.** When a device has no fix, the facility's location can be recorded
  instead. The record is flagged and shown in amber.
- **Free services.** New-trip routing uses the public OSRM demo server, with a straight
  line if it's unreachable. Map tiles come from OpenFreeMap. Neither is meant for
  production traffic.
- **Camera scanning** uses the browser's built-in barcode detector (Chrome on Android,
  not Safari). Typing the serial always works.

## Project layout

```
app/
  login/            sign-in
  (app)/            map, assets, trips, vehicles, people, scan, alerts, admin
components/         maps, custody timeline, alert list, simulator, location sharing,
                    trip, vehicle and person panels
lib/
  brand.ts          the product name, tagline and demo email domain
  types.ts          the data model
  rules.ts          route deviation, manifest reconciliation, stops, RFID presence
  domain.ts         every state change, with the rules and role checks
  permissions.ts    what each role may do
  custody.ts        how each hand-off moves an asset
  seed.ts           deterministic demo data
  simulator.ts      in-browser GPS and RFID replay, with staged incidents
  store.ts          localStorage persistence, synced across tabs
scripts/
  copy-maplibre-worker.mjs   runs before `dev` and `build`
```

MapLibre 6 draws map tiles using a background worker file. It expects that file to sit
next to its own script, and Next.js doesn't put it there. So before every `dev` and
`build`, `scripts/copy-maplibre-worker.mjs` copies the file into `public/maplibre/`
(gitignored), and the app points MapLibre at it. Vercel runs this step automatically.

Built with Next.js 15.5 (App Router), React 19, TypeScript 5.9, Tailwind CSS 4,
MapLibre GL 6 and Turf 7.
