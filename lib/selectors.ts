/** Read-only helpers over DemoState. */
import { AT_A_FACILITY } from "./custody";
import { formatKm } from "./format";
import { crewAwayLimitKm, FACILITY_RADIUS_KM, kmBetween, reconcileManifest, type ManifestReconciliation } from "./rules";
import {
  AssetState,
  CrewRole,
  CustodyEventType,
  TripState,
  type ActivityEntry,
  type Asset,
  type CustodyEvent,
  type DemoState,
  type Facility,
  type Fix,
  type GpsPing,
  type RfidEvent,
  type Trip,
  type User,
  type UserPing,
  type Vehicle,
} from "./types";

export function find<T extends { id: string }>(list: readonly T[], id: string | null | undefined): T | undefined {
  return id ? list.find((item) => item.id === id) : undefined;
}

export function lastPing(s: DemoState, tripId: string): GpsPing | undefined {
  for (let i = s.gpsPings.length - 1; i >= 0; i--) {
    if (s.gpsPings[i].tripId === tripId) return s.gpsPings[i];
  }
  return undefined;
}

export function tripPings(s: DemoState, tripId: string): GpsPing[] {
  return s.gpsPings.filter((p) => p.tripId === tripId);
}

const TYPE_ORDER = { VMD: 0, BALLOT_BOX: 1, BALLOT_PAPERS: 2 } as const;
export const byTypeThenSerial = (a: Asset, b: Asset) =>
  TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.serial.localeCompare(b.serial);

// ── Vehicles and the people on them ─────────────────────────────────────────

const DUTY_ORDER: Record<CrewRole, number> = { DRIVER: 0, ESCORT: 1, ELECTORAL_OFFICER: 2, SAPS_OFFICER: 3 };

/** The active users assigned to a vehicle, driver first. */
export function crewOf(s: DemoState, vehicleId: string): User[] {
  return s.users
    .filter((u) => u.active && u.vehicleId === vehicleId)
    .sort((a, b) => (a.duty ? DUTY_ORDER[a.duty] : 9) - (b.duty ? DUTY_ORDER[b.duty] : 9) || a.name.localeCompare(b.name));
}

export function driverOf(s: DemoState, vehicleId: string): User | undefined {
  return s.users.find((u) => u.active && u.vehicleId === vehicleId && u.duty === CrewRole.DRIVER);
}

/** The vehicle's planned, moving or arrived trip, if it has one. */
export function openTripFor(s: DemoState, vehicleId: string): Trip | undefined {
  return s.trips.find((t) => t.vehicleId === vehicleId && t.state !== TripState.CLOSED);
}

/** The vehicle's most recent GPS ping on any trip. */
export function vehiclePosition(s: DemoState, vehicleId: string): GpsPing | undefined {
  const trips = new Set(s.trips.filter((t) => t.vehicleId === vehicleId).map((t) => t.id));
  for (let i = s.gpsPings.length - 1; i >= 0; i--) {
    if (trips.has(s.gpsPings[i].tripId)) return s.gpsPings[i];
  }
  return undefined;
}

export function nearestFacility(s: DemoState, fix: Fix): { facility: Facility; km: number } {
  let best = { facility: s.facilities[0], km: Number.POSITIVE_INFINITY };
  for (const facility of s.facilities) {
    const km = kmBetween(fix, facility);
    if (km < best.km) best = { facility, km };
  }
  return best;
}

export type Onboard = {
  /** True while the vehicle is on a trip and its reader is reporting. */
  live: boolean;
  readAt: string | null;
  crew: { member: User; detected: boolean }[];
  assets: { asset: Asset; detected: boolean }[];
};

/** Who and what the vehicle should be carrying, against what its RFID reader last saw. */
export function onboard(s: DemoState, vehicle: Vehicle): Onboard {
  const trip = openTripFor(s, vehicle.id);
  const reading = vehicle.onboard;
  const live = !!reading && !!trip && (trip.state === TripState.IN_TRANSIT || trip.state === TripState.ARRIVED);
  const crewSeen = new Set(reading?.crewIds ?? []);
  const tagsSeen = new Set(reading?.assetIds ?? []);
  const loaded = trip
    ? s.assets.filter((a) => a.currentTripId === trip.id && a.state === AssetState.IN_TRANSIT).sort(byTypeThenSerial)
    : [];
  return {
    live,
    readAt: live && reading ? reading.readAt : null,
    crew: crewOf(s, vehicle.id).map((member) => ({ member, detected: live && crewSeen.has(member.id) })),
    assets: loaded.map((asset) => ({ asset, detected: live && tagsSeen.has(asset.id) })),
  };
}

/** Newest first. */
export function vehicleRfidEvents(s: DemoState, vehicleId: string, limit = 30): RfidEvent[] {
  const events: RfidEvent[] = [];
  for (let i = s.rfidEvents.length - 1; i >= 0 && events.length < limit; i--) {
    if (s.rfidEvents[i].vehicleId === vehicleId) events.push(s.rfidEvents[i]);
  }
  return events;
}

/** The person or asset an RFID event is about, as display text. */
export function rfidSubject(s: DemoState, e: RfidEvent): string | null {
  if (!e.subjectId) return null;
  return find(s.users, e.subjectId)?.name ?? find(s.assets, e.subjectId)?.serial ?? null;
}

// ── People ──────────────────────────────────────────────────────────────────

/** A person's latest location. */
export function userPosition(s: DemoState, userId: string): UserPing | undefined {
  for (let i = s.userPings.length - 1; i >= 0; i--) {
    if (s.userPings[i].userId === userId) return s.userPings[i];
  }
  return undefined;
}

/** A person's recent locations, oldest first. */
export function userTrail(s: DemoState, userId: string, limit = 400): UserPing[] {
  const trail: UserPing[] = [];
  for (let i = s.userPings.length - 1; i >= 0 && trail.length < limit; i--) {
    if (s.userPings[i].userId === userId) trail.push(s.userPings[i]);
  }
  return trail.reverse();
}

/** The trip a vehicle is on the road for: moving, or arrived and offloading. */
export function roadTripFor(s: DemoState, vehicleId: string): Trip | undefined {
  return s.trips.find((t) => t.vehicleId === vehicleId && (t.state === TripState.IN_TRANSIT || t.state === TripState.ARRIVED));
}

export type CrewDistance = {
  trip: Trip;
  vehicle: Vehicle;
  /** Where the vehicle is: its last ping, or its origin before the first one. */
  vehicleAt: Fix;
  km: number;
  limitKm: number;
  away: boolean;
  /** The origin or destination the vehicle is at, if it's at one. */
  facility: Facility | null;
};

/** How far a person is from their vehicle while it's on the road, and whether that's too far. Null when it isn't on the road. */
export function crewDistance(s: DemoState, user: Pick<User, "vehicleId">, fix: Fix): CrewDistance | null {
  const vehicle = find(s.vehicles, user.vehicleId);
  const trip = vehicle ? roadTripFor(s, vehicle.id) : undefined;
  if (!vehicle || !trip) return null;
  const ends = [find(s.facilities, trip.originFacilityId), find(s.facilities, trip.destFacilityId)].filter((f): f is Facility => !!f);
  const vehicleAt: Fix = lastPing(s, trip.id) ?? ends[0];
  const facility = ends.find((f) => kmBetween(vehicleAt, f) <= FACILITY_RADIUS_KM) ?? null;
  const limitKm = crewAwayLimitKm(s.settings.crewAwayMetres, !!facility);
  const km = kmBetween(fix, vehicleAt);
  return { trip, vehicle, vehicleAt, km, limitKm, away: km > limitKm, facility };
}

export type PersonState = "ON_BOARD" | "BADGE_NOT_READ" | "AWAY" | "AT_FACILITY" | "ELSEWHERE" | "UNKNOWN";

export type PersonStatus = {
  state: PersonState;
  label: string;
  position: UserPing | undefined;
  vehicle: Vehicle | undefined;
  /** Distance from their vehicle, while it's on the road. */
  distanceFromVehicleKm: number | null;
  /** Whether the vehicle's reader saw their badge on its latest read (null when it isn't reading). */
  badgeRead: boolean | null;
};

/** Where a person is now: against their vehicle while it's on the road, otherwise against the nearest facility. */
export function personStatus(s: DemoState, user: User): PersonStatus {
  const position = userPosition(s, user.id);
  const vehicle = find(s.vehicles, user.vehicleId);
  const base = { position, vehicle, distanceFromVehicleKm: null, badgeRead: null };
  if (!position) return { ...base, state: "UNKNOWN", label: "No location yet" };

  const gap = crewDistance(s, user, position);
  if (vehicle && gap) {
    const badgeRead = vehicle.onboard ? vehicle.onboard.crewIds.includes(user.id) : null;
    const withVehicle = { ...base, distanceFromVehicleKm: gap.km, badgeRead };
    if (gap.away) return { ...withVehicle, state: "AWAY", label: `${formatKm(gap.km)} from ${vehicle.registration}` };
    if (badgeRead === false && user.rfidBadge) {
      return { ...withVehicle, state: "BADGE_NOT_READ", label: `Near ${vehicle.registration}, badge not read` };
    }
    return { ...withVehicle, state: "ON_BOARD", label: gap.facility ? `With ${vehicle.registration} at ${gap.facility.name}` : `On board ${vehicle.registration}` };
  }

  const near = nearestFacility(s, position);
  if (near.km <= FACILITY_RADIUS_KM) return { ...base, state: "AT_FACILITY", label: `At ${near.facility.name}` };
  return { ...base, state: "ELSEWHERE", label: `${formatKm(near.km)} from ${near.facility.name}` };
}

/** Everything a person did, or that was done to them, newest first. */
export function userActivity(s: DemoState, userId: string, limit = 200): ActivityEntry[] {
  return s.activity
    .filter((e) => e.userId === userId || e.subjectUserId === userId)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}

/** Last time a person did anything in the app. */
export function lastActive(s: DemoState, userId: string): string | null {
  let latest: string | null = null;
  for (const e of s.activity) if (e.userId === userId && (!latest || e.at > latest)) latest = e.at;
  return latest;
}

// ── Trips ───────────────────────────────────────────────────────────────────

export type TripParts = { trip: Trip; origin: Facility; destination: Facility; vehicle: Vehicle; driver: User | undefined };

export function tripParts(s: DemoState, trip: Trip): TripParts {
  return {
    trip,
    origin: find(s.facilities, trip.originFacilityId)!,
    destination: find(s.facilities, trip.destFacilityId)!,
    vehicle: find(s.vehicles, trip.vehicleId)!,
    driver: driverOf(s, trip.vehicleId),
  };
}

/** Rule 2 inputs straight from the custody log: LOADs vs RECEIVEs on a trip. */
export function tripReconciliation(s: DemoState, tripId: string): ManifestReconciliation {
  const loaded: string[] = [];
  const received: string[] = [];
  for (const e of s.custodyEvents) {
    if (e.tripId !== tripId) continue;
    if (e.type === CustodyEventType.LOAD) loaded.push(e.assetId);
    else if (e.type === CustodyEventType.RECEIVE) received.push(e.assetId);
  }
  return reconcileManifest(loaded, received);
}

export type ManifestStatus = "PICKED" | "LOADED" | "RECEIVED" | "REPORTED_MISSING";
export type ManifestRow = { asset: Asset; status: ManifestStatus; load?: CustodyEvent; receive?: CustodyEvent };

/** Everything picked for, loaded onto or received off a trip, with its progress. */
export function tripManifest(s: DemoState, tripId: string): ManifestRow[] {
  const loads = new Map<string, CustodyEvent>();
  const receives = new Map<string, CustodyEvent>();
  for (const e of s.custodyEvents) {
    if (e.tripId !== tripId) continue;
    if (e.type === CustodyEventType.LOAD) loads.set(e.assetId, e);
    else if (e.type === CustodyEventType.RECEIVE) receives.set(e.assetId, e);
  }
  const ids = new Set([...loads.keys(), ...receives.keys()]);
  for (const a of s.assets) if (a.currentTripId === tripId) ids.add(a.id);

  return [...ids]
    .map((id) => {
      const asset = find(s.assets, id)!;
      const load = loads.get(id);
      const receive = receives.get(id);
      const status: ManifestStatus = receive
        ? "RECEIVED"
        : load
          ? asset.state === AssetState.MISSING
            ? "REPORTED_MISSING"
            : "LOADED"
          : "PICKED";
      return { asset, status, load, receive };
    })
    .sort((a, b) => byTypeThenSerial(a.asset, b.asset));
}

/** Assets a coordinator may pick for a PLANNED trip: at its origin, not on another manifest. */
export function pickableAssets(s: DemoState, trip: Trip): Asset[] {
  return s.assets
    .filter((a) => a.currentFacilityId === trip.originFacilityId && a.currentTripId === null && AT_A_FACILITY.includes(a.state))
    .sort(byTypeThenSerial);
}

export function plannedTripsFrom(s: DemoState, facilityId: string | null): Trip[] {
  return s.trips.filter((t) => t.state === TripState.PLANNED && t.originFacilityId === facilityId);
}

// ── Assets ──────────────────────────────────────────────────────────────────

export function assetLocation(s: DemoState, asset: Asset): { label: string; detail: string | null } {
  if (asset.state === AssetState.MISSING) return { label: "Unknown", detail: "Reported missing" };
  const trip = find(s.trips, asset.currentTripId);
  if (asset.state === AssetState.IN_TRANSIT && trip) {
    const { vehicle, destination } = tripParts(s, trip);
    return {
      label: `On ${vehicle.registration}`,
      detail: trip.state === TripState.PLANNED ? `Loaded, awaiting dispatch to ${destination.name}` : `Heading to ${destination.name}`,
    };
  }
  const facility = find(s.facilities, asset.currentFacilityId);
  return {
    label: facility?.name ?? "Unknown",
    detail: trip ? `Picked for the trip to ${find(s.facilities, trip.destFacilityId)?.name}` : null,
  };
}

/** Where the asset is on the map right now: its facility, or its vehicle's last ping. */
export function assetPosition(s: DemoState, asset: Asset): Fix | null {
  if (asset.state === AssetState.MISSING) return null;
  if (asset.state === AssetState.IN_TRANSIT) {
    const trip = find(s.trips, asset.currentTripId);
    if (!trip) return null;
    return lastPing(s, trip.id) ?? find(s.facilities, trip.originFacilityId) ?? null;
  }
  return find(s.facilities, asset.currentFacilityId) ?? null;
}

/** Where an asset's location link opens the map: its vehicle's trip, or its facility. */
export function assetMapHref(asset: Asset): string | null {
  if (asset.state === AssetState.MISSING) return null;
  if (asset.state === AssetState.IN_TRANSIT && asset.currentTripId) return `/map?trip=${asset.currentTripId}`;
  return asset.currentFacilityId ? `/map?facility=${asset.currentFacilityId}` : null;
}

export function assetEvents(s: DemoState, assetId: string): CustodyEvent[] {
  return s.custodyEvents.filter((e) => e.assetId === assetId);
}

/** The seal recorded when an asset was loaded onto a trip, to check at receipt. */
export function loadSeal(s: DemoState, assetId: string, tripId: string): string | null {
  for (let i = s.custodyEvents.length - 1; i >= 0; i--) {
    const e = s.custodyEvents[i];
    if (e.assetId === assetId && e.tripId === tripId && e.type === CustodyEventType.LOAD) return e.sealNumber;
  }
  return null;
}

/** Where a custody event physically happened. */
export function eventFacility(s: DemoState, e: CustodyEvent): Facility | undefined {
  return find(s.facilities, e.toFacilityId ?? e.fromFacilityId);
}

export type HandoffOption = { type: CustodyEventType; label: string; hint: string; disabledReason: string | null };

/** The hand-offs that make sense for an asset right now (Scan screen). */
export function handoffOptions(s: DemoState, asset: Asset): HandoffOption[] {
  const options: HandoffOption[] = [];
  if (AT_A_FACILITY.includes(asset.state)) {
    const trips = plannedTripsFrom(s, asset.currentFacilityId);
    options.push({
      type: CustodyEventType.LOAD,
      label: "Load onto vehicle",
      hint: "Release it to a planned trip leaving this facility",
      disabledReason: trips.length ? null : "No planned trip leaves this facility",
    });
  }
  if (asset.state === AssetState.IN_TRANSIT) {
    const trip = find(s.trips, asset.currentTripId);
    const parts = trip ? tripParts(s, trip) : null;
    options.push({
      type: CustodyEventType.RECEIVE,
      label: "Receive at destination",
      hint: parts ? `Off ${parts.vehicle.registration} into ${parts.destination.name}` : "",
      disabledReason: trip?.state === TripState.PLANNED ? "The trip hasn't been dispatched yet" : null,
    });
  }
  if (asset.state === AssetState.MISSING) {
    options.push({ type: CustodyEventType.INTAKE, label: "Recovered: book into stock", hint: "Take a found asset back into a warehouse", disabledReason: null });
  } else {
    options.push({ type: CustodyEventType.REPORT_MISSING, label: "Report missing", hint: "It can't be found; its location becomes unknown", disabledReason: null });
  }
  return options;
}
