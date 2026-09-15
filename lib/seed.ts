/**
 * Demo data: one Johannesburg warehouse, eight Gauteng voting stations,
 * 60 RFID-tagged assets, 4 vehicles with in-cab readers, 13 people (3 office
 * staff, 9 field crew with RFID badges, 8 of them assigned to vehicles, and a
 * presiding officer), 3 trips (CLOSED, IN_TRANSIT, PLANNED), everyone's
 * recent phone locations and an activity log of who did what.
 *
 * Built in the browser on the first visit and on "Reset demo data".
 * Deterministic: a fixed PRNG gives the same IDs, tags, GPS jitter and
 * breadcrumbs every time, while timestamps are relative to `nowMs` so the
 * IN_TRANSIT trip is always live. Custody history runs through
 * lib/custody.ts and the trips are checked against lib/rules.ts: the same
 * code the app runs.
 */
import { along, distance, length } from "@turf/turf";
import { EMAIL_DOMAIN } from "./brand";
import { applyCustody, type AssetPosition, type CustodyStep } from "./custody";
import { DEFAULT_ROLE_PERMISSIONS } from "./permissions";
import {
  distanceFromRouteKm,
  evaluateRouteDeviation,
  reconcileManifest,
  ROUTE_DEVIATION_KM,
  routeDeviationMessage,
  routeLine,
  toLngLat,
} from "./rules";
import {
  ActivityKind,
  AlertType,
  AssetType,
  CrewRole,
  CustodyEventType,
  FacilityType,
  GpsSource,
  PingSource,
  RfidEventKind,
  Role,
  SCHEMA_VERSION,
  TripState,
  VehicleStatus,
  type ActivityEntry,
  type Asset,
  type CustodyEvent,
  type DemoState,
  type Facility,
  type Fix,
  type GpsPing,
  type LatLng,
  type RfidEvent,
  type Trip,
  type User,
  type UserPing,
  type Vehicle,
} from "./types";
import { FIELD_PASSWORD, SEED_STAFF } from "./users";

const MIN = 60_000;
const SAST_OFFSET_MS = 120 * MIN; // UTC+2, no daylight saving
const round7 = (n: number) => Math.round(n * 1e7) / 1e7;

/** mulberry32: tiny, fast, deterministic. */
function prng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type AssetSeed = { id: string; serial: string; type: AssetType; rfidTag: string };
type Crumb = Fix & { atMs: number };

export function buildSeed(nowMs: number): DemoState {
  const rand = prng(0x20261104); // polling day, 4 Nov 2026

  const uuid = (): string => {
    const b = Array.from({ length: 16 }, () => Math.floor(rand() * 256));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = b.map((x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
  /** A 96-bit EPC: the prefix plus random hex, 24 characters. */
  const epc = (prefix: string) =>
    (prefix + Array.from({ length: 24 }, () => Math.floor(rand() * 16).toString(16)).join("")).slice(0, 24).toUpperCase();
  const jitter = (fix: Fix, metres: number): Fix => ({
    lat: fix.lat + ((rand() * 2 - 1) * metres) / 111_320,
    lng: fix.lng + ((rand() * 2 - 1) * metres) / (111_320 * Math.cos((fix.lat * Math.PI) / 180)),
  });
  const iso = (ms: number) => new Date(ms).toISOString();
  /** hh:mm SAST on the day `daysAgo` days before today (SAST), as epoch ms. */
  const sast = (daysAgo: number, hh: number, mm = 0) => {
    const today = new Date(nowMs + SAST_OFFSET_MS);
    return Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - daysAgo, hh, mm) - SAST_OFFSET_MS;
  };
  const minutesAgo = (m: number) => nowMs - m * MIN;

  // ── Facilities ────────────────────────────────────────────────────────────

  const facility = (name: string, type: FacilityType, municipality: string, lat: number, lng: number): Facility => ({
    id: uuid(),
    name,
    type,
    municipality,
    province: "Gauteng",
    lat,
    lng,
  });
  const warehouse = facility("IEC Warehouse, City Deep", FacilityType.WAREHOUSE, "City of Johannesburg", -26.2285, 28.0742);
  const station = (name: string, municipality: string, lat: number, lng: number) =>
    facility(name, FacilityType.VOTING_STATION, municipality, lat, lng);

  // Real places, illustrative station names: schools, halls, churches and a
  // temporary tent, which is what IEC voting stations actually are.
  const stations = {
    orlandoWest: station("Orlando West Secondary School, Soweto", "City of Johannesburg", -26.2386, 27.9077),
    alexandra: station("Alexandra Community Hall", "City of Johannesburg", -26.104, 28.096),
    diepsloot: station("Diepsloot Ext. 6 Temporary Station (tent)", "City of Johannesburg", -25.933, 28.012),
    mamelodi: station("Mamelodi East Primary School", "City of Tshwane", -25.711, 28.409),
    soshanguve: station("Soshanguve Block L Methodist Church", "City of Tshwane", -25.523, 28.101),
    tembisa: station("Tembisa Esangweni Community Hall", "Ekurhuleni", -25.999, 28.227),
    katlehong: station("Katlehong Secondary School", "Ekurhuleni", -26.345, 28.155),
    sebokeng: station("Sebokeng Zone 7 Lutheran Church", "Emfuleni", -26.585, 27.842),
  };

  // ── Vehicles: Gauteng plates, a windscreen RFID tag and an in-cab reader each

  const vehicle = (registration: string, seats: number, status: VehicleStatus): Vehicle => ({
    id: uuid(),
    registration,
    status,
    rfidTag: epc("E2801170"),
    readerId: `RDR-${registration.replace(/\s+/g, "")}`,
    seats,
    onboard: null,
  });
  const vehicles = {
    closedTrip: vehicle("JK 21 LM GP", 5, VehicleStatus.AVAILABLE), // double-cab bakkie
    inTransit: vehicle("FT 08 RX GP", 3, VehicleStatus.ON_TRIP), // panel van
    planned: vehicle("CP 77 WD GP", 3, VehicleStatus.AVAILABLE), // light truck
    workshop: vehicle("TKD 482 GP", 2, VehicleStatus.OUT_OF_SERVICE),
  };

  // ── People. Every one of them is a user who can sign in. Office staff work
  //    from City Deep; the field crew carry RFID badges and are assigned to a
  //    vehicle with a duty. Phone numbers are fictitious.

  const staff: User[] = SEED_STAFF.map((u) => ({ ...u }));
  const [admin, coordinator, warehouseOfficer] = staff;
  const person = (name: string, role: Role, phone: string, v: Vehicle | null, duty: CrewRole | null): User => ({
    id: uuid(),
    name,
    email: `${name.toLowerCase().replace(/\s+/g, ".")}@${EMAIL_DOMAIN}`,
    role,
    password: FIELD_PASSWORD,
    active: true,
    phone,
    rfidBadge: epc("E2003412"),
    vehicleId: v?.id ?? null,
    duty: v ? duty : null,
  });
  const field = [
    person("Mandla Zulu", Role.CREW, "+27820000101", vehicles.closedTrip, CrewRole.DRIVER),
    person("Busisiwe Mthembu", Role.OFFICER, "+27820000111", vehicles.closedTrip, CrewRole.ELECTORAL_OFFICER),
    person("Kagiso Molefe", Role.CREW, "+27820000102", vehicles.inTransit, CrewRole.DRIVER),
    person("Thabo Mokoena", Role.CREW, "+27820000112", vehicles.inTransit, CrewRole.ESCORT),
    person("Zanele Dube", Role.CREW, "+27820000113", vehicles.inTransit, CrewRole.SAPS_OFFICER),
    person("Nomsa Mahlangu", Role.CREW, "+27820000103", vehicles.planned, CrewRole.DRIVER),
    person("Ruan de Villiers", Role.OFFICER, "+27820000114", vehicles.planned, CrewRole.ELECTORAL_OFFICER),
    person("Pieter Joubert", Role.CREW, "+27820000104", vehicles.workshop, CrewRole.DRIVER),
    person("Ayanda Khumalo", Role.CREW, "+27820000115", null, null), // not assigned yet
    person("Lerato Ndlovu", Role.OFFICER, "+27820000116", null, null), // presiding officer, Orlando West
  ];
  const named = (name: string) => field.find((u) => u.name === name)!;
  const crewOn = (v: Vehicle) => field.filter((u) => u.vehicleId === v.id);
  const driverName = (v: Vehicle) => crewOn(v).find((u) => u.duty === CrewRole.DRIVER)!.name;

  const tripIds = { closed: uuid(), inTransit: uuid(), planned: uuid() };

  // ── Assets: 40 VMDs, 10 ballot boxes, 10 ballot-paper consignments ───────

  const pad = (n: number) => String(n).padStart(4, "0");
  const asset = (serial: string, type: AssetType): AssetSeed => ({ id: uuid(), serial, type, rfidTag: epc("E2806894") });
  const vmds = Array.from({ length: 40 }, (_, i) => asset(`VMD-GP-${pad(i + 1)}`, AssetType.VMD));
  const boxes = Array.from({ length: 10 }, (_, i) => asset(`BBX-GP-${pad(i + 1)}`, AssetType.BALLOT_BOX));
  // Metros (Johannesburg, Tshwane) issue two ballots: ward + PR. Emfuleni is a
  // local municipality inside Sedibeng district, so it adds a District Council ballot.
  const ballots = [
    "BP-WARD-0001", "BP-PR-0001",
    "BP-WARD-0002", "BP-PR-0002", "BP-DC-0001",
    "BP-WARD-0003", "BP-PR-0003",
    "BP-WARD-0004", "BP-PR-0004", "BP-WARD-0005",
  ].map((serial) => asset(serial, AssetType.BALLOT_PAPERS));
  const allAssets = [...vmds, ...boxes, ...ballots];

  const bySerial = new Map(allAssets.map((a) => [a.serial, a]));
  const pick = (...serials: string[]) => serials.map((s) => bySerial.get(s)!);
  const manifests = {
    closed: [...vmds.slice(0, 5), ...boxes.slice(0, 2), ...pick("BP-WARD-0001", "BP-PR-0001")], // 9
    inTransit: [...vmds.slice(5, 10), ...boxes.slice(2, 4), ...pick("BP-WARD-0002", "BP-PR-0002", "BP-DC-0001")], // 10
    planned: [...vmds.slice(10, 16), ...boxes.slice(4, 6), ...pick("BP-WARD-0003", "BP-PR-0003")], // 10, picked not loaded
  };
  const missingAtStocktake = vmds[39];

  // ── Who recorded the custody history.

  const presidingOfficer = named("Lerato Ndlovu");

  // ── Seals: VMDs travel five to a sealed crate; boxes and consignments are sealed individually.

  let lastSeal = 204_510;
  const sealsFor = (assets: AssetSeed[]) => {
    const seals = new Map<string, string>();
    let crateSeal = "";
    let vmdCount = 0;
    for (const a of assets) {
      if (a.type === AssetType.VMD) {
        if (vmdCount++ % 5 === 0) crateSeal = `SL-${++lastSeal}`;
        seals.set(a.id, crateSeal);
      } else {
        seals.set(a.id, `SL-${++lastSeal}`);
      }
    }
    return seals;
  };

  // ── Planned routes: [lat, lng] waypoints along the real roads ─────────────

  const at = (f: Facility): LatLng => [f.lat, f.lng];

  const routeToOrlandoWest: LatLng[] = [
    at(warehouse),
    [-26.2175, 28.062], // M2 on-ramp, Heriotdale
    [-26.2155, 28.035], // M2 westbound
    [-26.218, 28.015], // M1/M2 interchange
    [-26.229, 28.0], // Crown Mines
    [-26.236, 27.98], // Soweto Highway at Nasrec
    [-26.237, 27.95],
    [-26.2386, 27.925], // Orlando East
    at(stations.orlandoWest),
  ];
  // What the CLOSED trip actually drove: Soweto Highway was shut at Nasrec by a
  // service-delivery protest and the driver detoured south through Klipspruit.
  const drivenToOrlandoWest: LatLng[] = [
    ...routeToOrlandoWest.slice(0, 6),
    [-26.252, 27.972],
    [-26.264, 27.952], // ~3 km south of the planned line
    [-26.26, 27.932],
    [-26.246, 27.923],
    ...routeToOrlandoWest.slice(7),
  ];
  const routeToSebokeng: LatLng[] = [
    at(warehouse),
    [-26.241, 28.056],
    [-26.256, 28.028], // Booysens
    [-26.27, 27.999], // Uncle Charlie's interchange
    [-26.305, 27.96], // Golden Highway (R553)
    [-26.35, 27.915],
    [-26.4, 27.875], // Ennerdale
    [-26.455, 27.86],
    [-26.51, 27.85], // Evaton
    [-26.55, 27.845],
    at(stations.sebokeng),
  ];
  const routeToMamelodi: LatLng[] = [
    at(warehouse),
    [-26.233, 28.1],
    [-26.23, 28.13], // N3 Eastern Bypass
    [-26.186, 28.137], // Geldenhuys interchange
    [-26.133, 28.126],
    [-26.085, 28.12], // Marlboro
    [-26.06, 28.11], // Buccleuch interchange, onto the N1
    [-25.996, 28.127], // Midrand
    [-25.93, 28.15],
    [-25.86, 28.185], // Centurion
    [-25.81, 28.25],
    [-25.78, 28.29], // N1/N4 interchange
    [-25.755, 28.33], // N4 east
    [-25.73, 28.37], // Solomon Mahlangu Drive
    at(stations.mamelodi),
  ];

  /** A ping every `everySec` along `path` at a varying urban speed, until the path ends or the clock reaches `untilMs`. */
  const drive = (path: LatLng[], startMs: number, o: { avgKmh: number; everySec: number; untilMs?: number }): Crumb[] => {
    const line = routeLine(path);
    const totalKm = length(line, { units: "kilometers" });
    const stopAt = o.untilMs ?? Number.POSITIVE_INFINITY;
    const crumbs: Crumb[] = [];
    let km = 0;
    let t = startMs;
    while (t <= stopAt) {
      const [lng, lat] = along(line, Math.min(km, totalKm), { units: "kilometers" }).geometry.coordinates;
      crumbs.push({ ...jitter({ lat, lng }, 6), atMs: t });
      if (km >= totalKm) break;
      km += (o.avgKmh * (0.6 + rand() * 0.8) * o.everySec) / 3600;
      t += o.everySec * 1000;
    }
    return crumbs;
  };

  // ── Custody history, through the app's own state machine ──────────────────

  const custodyEvents: CustodyEvent[] = [];
  const positions = new Map<string, AssetPosition>();
  const record = (
    a: AssetSeed,
    step: CustodyStep,
    atMs: number,
    officer: User,
    custodian: string | null,
    where: Fix,
    seal: string | null = null,
  ) => {
    const { after, columns } = applyCustody(positions.get(a.id) ?? null, step);
    positions.set(a.id, after);
    const fix = jitter(where, 15);
    custodyEvents.push({
      id: uuid(),
      type: step.type,
      assetId: a.id,
      ...columns,
      officerId: officer.id,
      officerName: officer.name,
      custodian,
      sealNumber: seal,
      lat: round7(fix.lat),
      lng: round7(fix.lng),
      gpsAccuracyM: Math.round(6 + rand() * 14),
      gpsSource: GpsSource.DEVICE,
      createdAt: iso(atMs),
    });
  };
  const rfidEvents: RfidEvent[] = [];
  const gate = (v: Vehicle, tripId: string, kind: RfidEventKind, where: Fix, atMs: number) =>
    rfidEvents.push({ id: uuid(), vehicleId: v.id, tripId, kind, subjectId: null, lat: where.lat, lng: where.lng, at: iso(atMs) });

  // 1. Stock intake at City Deep, two weeks out.
  allAssets.forEach((a, i) => {
    record(a, { type: CustodyEventType.INTAKE, toFacilityId: warehouse.id }, sast(14, 9) + i * 1.5 * MIN, warehouseOfficer, warehouseOfficer.name, warehouse);
  });

  // 2. One VMD not found at the stocktake.
  record(missingAtStocktake, { type: CustodyEventType.REPORT_MISSING }, sast(9, 15, 10), warehouseOfficer, null, warehouse);

  // 3. CLOSED trip: City Deep -> Orlando West, six days ago, with a protest detour.
  const closedSeals = sealsFor(manifests.closed);
  manifests.closed.forEach((a, i) => {
    record(a, { type: CustodyEventType.LOAD, tripId: tripIds.closed, fromFacilityId: warehouse.id },
      sast(6, 7, 10) + i * 1.5 * MIN, warehouseOfficer, driverName(vehicles.closedTrip), warehouse, closedSeals.get(a.id));
  });
  const closedDeparted = sast(6, 7, 30);
  gate(vehicles.closedTrip, tripIds.closed, RfidEventKind.GATE_OUT, warehouse, closedDeparted);
  const closedCrumbs = drive(drivenToOrlandoWest, closedDeparted, { avgKmh: 32, everySec: 30 });

  // Rule 3 over the recorded breadcrumbs, exactly as recordPing() runs it.
  const closedDeviations = closedCrumbs.flatMap((c, i) => {
    const check = evaluateRouteDeviation(routeToOrlandoWest, c, i > 0 ? closedCrumbs[i - 1] : null);
    return check.raiseAlert ? [{ crumb: c, km: check.distanceKm }] : [];
  });
  if (closedDeviations.length !== 1) throw new Error(`Seed: expected 1 deviation on the closed trip, got ${closedDeviations.length}`);
  const [closedDeviation] = closedDeviations;

  const closedArrived = closedCrumbs[closedCrumbs.length - 1].atMs + MIN;
  gate(vehicles.closedTrip, tripIds.closed, RfidEventKind.GATE_IN, stations.orlandoWest, closedArrived);
  manifests.closed.forEach((a, i) => {
    record(a, {
      type: CustodyEventType.RECEIVE,
      tripId: tripIds.closed,
      toFacilityId: stations.orlandoWest.id,
      toFacilityType: FacilityType.VOTING_STATION,
      tripOriginType: FacilityType.WAREHOUSE,
    }, closedArrived + (5 + i) * MIN, presidingOfficer, presidingOfficer.name, stations.orlandoWest, closedSeals.get(a.id));
  });
  const closedClosed = closedArrived + (5 + manifests.closed.length + 8) * MIN;

  // Rule 2 must pass, or the trip could never have been CLOSED.
  const eventsFor = (tripId: string, type: CustodyEventType) =>
    custodyEvents.filter((e) => e.tripId === tripId && e.type === type).map((e) => e.assetId);
  if (!reconcileManifest(eventsFor(tripIds.closed, CustodyEventType.LOAD), eventsFor(tripIds.closed, CustodyEventType.RECEIVE)).balanced) {
    throw new Error("Seed: the closed trip does not reconcile");
  }

  // 4. IN_TRANSIT trip: City Deep -> Sebokeng, left ~46 minutes ago with a driver, an escort and a SAPS officer.
  const transitSeals = sealsFor(manifests.inTransit);
  manifests.inTransit.forEach((a, i) => {
    record(a, { type: CustodyEventType.LOAD, tripId: tripIds.inTransit, fromFacilityId: warehouse.id },
      minutesAgo(70) + i * 1.2 * MIN, warehouseOfficer, driverName(vehicles.inTransit), warehouse, transitSeals.get(a.id));
  });
  const transitDeparted = minutesAgo(46);
  gate(vehicles.inTransit, tripIds.inTransit, RfidEventKind.GATE_OUT, warehouse, transitDeparted);
  const transitCrumbs = drive(routeToSebokeng, transitDeparted, { avgKmh: 42, everySec: 30, untilMs: minutesAgo(0.5) });
  if (transitCrumbs.some((c) => distanceFromRouteKm(routeToSebokeng, c) > ROUTE_DEVIATION_KM)) {
    throw new Error("Seed: in-transit breadcrumbs strayed off the planned route");
  }
  const lastCrumb = transitCrumbs[transitCrumbs.length - 1];
  if (distance(toLngLat(at(stations.sebokeng)), [lastCrumb.lng, lastCrumb.lat], { units: "kilometers" }) < 5) {
    throw new Error("Seed: the in-transit trip is already at its destination");
  }
  // Its reader's latest read: all three crew and all ten assets on board.
  vehicles.inTransit.onboard = {
    crewIds: crewOn(vehicles.inTransit).map((c) => c.id),
    assetIds: manifests.inTransit.map((a) => a.id),
    readAt: iso(lastCrumb.atMs),
    lat: round7(lastCrumb.lat),
    lng: round7(lastCrumb.lng),
  };

  // 5. PLANNED trip: City Deep -> Mamelodi East. Manifest picked (planning, not
  //    custody), so the assets stay IN_WAREHOUSE with currentTripId set.
  const plannedPicks = new Set(manifests.planned.map((a) => a.id));

  // ── Assemble ──────────────────────────────────────────────────────────────

  const pings = (tripId: string, crumbs: Crumb[]): GpsPing[] =>
    crumbs.map((c) => ({ id: uuid(), tripId, lat: round7(c.lat), lng: round7(c.lng), recordedAt: iso(c.atMs) }));

  // ── Where everyone's phone has been. On a trip, a phone rides a few metres from its vehicle's tracker.

  const userPings: UserPing[] = [];
  const seen = (u: User, where: Fix, atMs: number, trip?: { id: string; vehicleAt: Fix }) => {
    const fix = jitter(where, trip ? 4 : 20);
    const km = trip ? distance([fix.lng, fix.lat], [trip.vehicleAt.lng, trip.vehicleAt.lat], { units: "kilometers" }) : null;
    userPings.push({
      id: uuid(),
      userId: u.id,
      lat: round7(fix.lat),
      lng: round7(fix.lng),
      accuracyM: Math.round(5 + rand() * 15),
      source: PingSource.SIMULATED,
      tripId: trip?.id ?? null,
      vehicleDistanceM: km === null ? null : Math.round(km * 1000),
      away: false,
      recordedAt: iso(atMs),
    });
  };
  const ride = (people: User[], tripId: string, crumbs: Crumb[], every: number) =>
    crumbs.forEach((c, i) => {
      if (i % every === 0 || i === crumbs.length - 1) for (const u of people) seen(u, c, c.atMs + 2_000, { id: tripId, vehicleAt: c });
    });

  // The closed trip's crew, six days ago, then back on standby at City Deep this morning.
  for (const u of crewOn(vehicles.closedTrip)) seen(u, warehouse, closedDeparted - 20 * MIN);
  ride(crewOn(vehicles.closedTrip), tripIds.closed, closedCrumbs, 4);
  for (const u of crewOn(vehicles.closedTrip)) seen(u, stations.orlandoWest, closedClosed);
  for (const u of crewOn(vehicles.closedTrip)) seen(u, warehouse, minutesAgo(170));
  // The in-transit crew: at the warehouse while loading, then riding with the vehicle.
  for (const m of [75, 65, 55]) for (const u of crewOn(vehicles.inTransit)) seen(u, warehouse, minutesAgo(m));
  ride(crewOn(vehicles.inTransit), tripIds.inTransit, transitCrumbs, 1);
  // The planned trip's crew waiting at City Deep; the rest where they work.
  for (const m of [30, 20, 10, 2]) for (const u of crewOn(vehicles.planned)) seen(u, warehouse, minutesAgo(m));
  seen(named("Pieter Joubert"), warehouse, minutesAgo(190));
  seen(named("Ayanda Khumalo"), warehouse, minutesAgo(45));
  for (const m of [60, 15]) seen(presidingOfficer, stations.orlandoWest, minutesAgo(m));
  seen(admin, warehouse, minutesAgo(20));
  for (const m of [40, 5]) seen(coordinator, warehouse, minutesAgo(m));
  for (const m of [80, 8]) seen(warehouseOfficer, warehouse, minutesAgo(m));

  // ── Who did what, as the app would have logged it.

  const activity: ActivityEntry[] = [];
  const did = (
    u: User,
    kind: ActivityKind,
    summary: string,
    atMs: number,
    refs: Partial<Pick<ActivityEntry, "tripId" | "assetId" | "vehicleId" | "subjectUserId">> = {},
    where: Fix | null = warehouse,
  ) =>
    activity.push({
      id: uuid(),
      userId: u.id,
      kind,
      summary,
      tripId: refs.tripId ?? null,
      assetId: refs.assetId ?? null,
      vehicleId: refs.vehicleId ?? null,
      subjectUserId: refs.subjectUserId ?? null,
      lat: where ? round7(where.lat) : null,
      lng: where ? round7(where.lng) : null,
      at: iso(atMs),
    });
  const names = (v: Vehicle) => crewOn(v).map((u) => u.name).join(", ");
  const closedRefs = { tripId: tripIds.closed, vehicleId: vehicles.closedTrip.id };
  const transitRefs = { tripId: tripIds.inTransit, vehicleId: vehicles.inTransit.id };
  const plannedRefs = { tripId: tripIds.planned, vehicleId: vehicles.planned.id };

  did(warehouseOfficer, ActivityKind.SESSION, "Signed in", sast(14, 8, 50));
  did(warehouseOfficer, ActivityKind.HANDOFF, `Booked ${allAssets.length} assets into ${warehouse.name}`, sast(14, 9) + allAssets.length * 1.5 * MIN);
  did(warehouseOfficer, ActivityKind.HANDOFF, `Reported ${missingAtStocktake.serial} missing`, sast(9, 15, 10), { assetId: missingAtStocktake.id });
  did(coordinator, ActivityKind.TRIP, `Planned a trip from ${warehouse.name} to ${stations.orlandoWest.name} on ${vehicles.closedTrip.registration}`, sast(7, 16, 30), closedRefs);
  did(coordinator, ActivityKind.MANIFEST, `Picked ${manifests.closed.length} assets for the trip to ${stations.orlandoWest.name}`, sast(7, 16, 35), closedRefs);
  did(warehouseOfficer, ActivityKind.HANDOFF, `Loaded ${manifests.closed.length} assets onto ${vehicles.closedTrip.registration}`, sast(6, 7, 25), closedRefs);
  did(coordinator, ActivityKind.TRIP, `Dispatched ${vehicles.closedTrip.registration} to ${stations.orlandoWest.name} with ${manifests.closed.length} assets and 2 crew (${names(vehicles.closedTrip)})`, closedDeparted, closedRefs);
  did(coordinator, ActivityKind.ALERT, `Acknowledged route deviation on ${vehicles.closedTrip.registration}`, closedDeviation.crumb.atMs + 4 * MIN, closedRefs);
  did(presidingOfficer, ActivityKind.HANDOFF, `Received ${manifests.closed.length} assets at ${stations.orlandoWest.name} off ${vehicles.closedTrip.registration}`, closedArrived + 13 * MIN, closedRefs, stations.orlandoWest);
  did(coordinator, ActivityKind.TRIP, `Closed the trip to ${stations.orlandoWest.name}: all ${manifests.closed.length} assets received`, closedClosed, closedRefs);
  did(coordinator, ActivityKind.TRIP, `Planned a trip from ${warehouse.name} to ${stations.sebokeng.name} on ${vehicles.inTransit.registration}`, sast(1, 14, 45), transitRefs);
  did(coordinator, ActivityKind.MANIFEST, `Picked ${manifests.inTransit.length} assets for the trip to ${stations.sebokeng.name}`, sast(1, 14, 50), transitRefs);
  did(admin, ActivityKind.ASSIGNMENT, `Assigned Zanele Dube to ${vehicles.inTransit.registration} as SAPS officer`, sast(1, 15, 5), {
    vehicleId: vehicles.inTransit.id,
    subjectUserId: named("Zanele Dube").id,
  });
  did(warehouseOfficer, ActivityKind.SESSION, "Signed in", minutesAgo(81));
  for (const u of crewOn(vehicles.inTransit)) did(u, ActivityKind.SESSION, "Signed in", minutesAgo(76));
  did(warehouseOfficer, ActivityKind.HANDOFF, `Loaded ${manifests.inTransit.length} assets onto ${vehicles.inTransit.registration}`, minutesAgo(58), transitRefs);
  did(coordinator, ActivityKind.TRIP, `Dispatched ${vehicles.inTransit.registration} to ${stations.sebokeng.name} with ${manifests.inTransit.length} assets and 3 crew (${names(vehicles.inTransit)})`, transitDeparted, transitRefs);
  did(coordinator, ActivityKind.TRIP, `Planned a trip from ${warehouse.name} to ${stations.mamelodi.name} on ${vehicles.planned.registration}`, minutesAgo(95), plannedRefs);
  did(coordinator, ActivityKind.MANIFEST, `Picked ${manifests.planned.length} assets for the trip to ${stations.mamelodi.name}`, minutesAgo(92), plannedRefs);
  for (const u of crewOn(vehicles.planned)) did(u, ActivityKind.SESSION, "Signed in", minutesAgo(31));
  did(admin, ActivityKind.SESSION, "Signed in", minutesAgo(21));

  const trips: Trip[] = [
    {
      id: tripIds.closed,
      originFacilityId: warehouse.id,
      destFacilityId: stations.orlandoWest.id,
      vehicleId: vehicles.closedTrip.id,
      state: TripState.CLOSED,
      plannedRoute: routeToOrlandoWest,
      departedAt: iso(closedDeparted),
      arrivedAt: iso(closedArrived),
      closedAt: iso(closedClosed),
      createdAt: iso(sast(7, 16, 30)),
    },
    {
      id: tripIds.inTransit,
      originFacilityId: warehouse.id,
      destFacilityId: stations.sebokeng.id,
      vehicleId: vehicles.inTransit.id,
      state: TripState.IN_TRANSIT,
      plannedRoute: routeToSebokeng,
      departedAt: iso(transitDeparted),
      arrivedAt: null,
      closedAt: null,
      createdAt: iso(sast(1, 14, 45)),
    },
    {
      id: tripIds.planned,
      originFacilityId: warehouse.id,
      destFacilityId: stations.mamelodi.id,
      vehicleId: vehicles.planned.id,
      state: TripState.PLANNED,
      plannedRoute: routeToMamelodi,
      departedAt: null,
      arrivedAt: null,
      closedAt: null,
      createdAt: iso(minutesAgo(95)),
    },
  ];

  const assets: Asset[] = allAssets.map((a) => {
    const p = positions.get(a.id)!;
    return {
      ...a,
      state: p.state,
      currentFacilityId: p.currentFacilityId,
      currentTripId: plannedPicks.has(a.id) ? tripIds.planned : p.currentTripId,
    };
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    rev: 0,
    seededAt: iso(nowMs),
    users: [...staff, ...field],
    facilities: [warehouse, ...Object.values(stations)],
    vehicles: Object.values(vehicles),
    assets,
    trips,
    custodyEvents,
    gpsPings: [...pings(tripIds.closed, closedCrumbs), ...pings(tripIds.inTransit, transitCrumbs)],
    userPings: userPings.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt)),
    rfidEvents,
    activity: activity.sort((a, b) => a.at.localeCompare(b.at)),
    alerts: [
      {
        id: uuid(),
        tripId: tripIds.closed,
        type: AlertType.ROUTE_DEVIATION,
        message: routeDeviationMessage(vehicles.closedTrip.registration, closedDeviation.km, stations.orlandoWest.name),
        lat: round7(closedDeviation.crumb.lat),
        lng: round7(closedDeviation.crumb.lng),
        userId: null,
        acknowledged: true,
        acknowledgedBy: coordinator.name,
        acknowledgedAt: iso(closedDeviation.crumb.atMs + 4 * MIN),
        createdAt: iso(closedDeviation.crumb.atMs),
      },
    ],
    settings: { stopAlertMinutes: 2, crewAwayMetres: 100 },
    rolePermissions: {
      COORDINATOR: [...DEFAULT_ROLE_PERMISSIONS.COORDINATOR],
      OFFICER: [...DEFAULT_ROLE_PERMISSIONS.OFFICER],
      CREW: [...DEFAULT_ROLE_PERMISSIONS.CREW],
    },
  };
}
