/**
 * Domain commands: the app's "API". Each takes the current state and returns
 * the next one without mutating the old; lib/store.ts persists the result.
 *
 * Rule 1  Custody events are append-only. recordCustody() is the only code
 *         that touches state.custodyEvents, and it only ever appends.
 * Rule 2  closeTrip() refuses unless LOADs == RECEIVEs, and raises
 *         MANIFEST_MISMATCH when it refuses. It never passes silently.
 * Rule 3  recordPing() checks every ping against the planned route and
 *         raises ROUTE_DEVIATION beyond 2 km.
 *
 * recordPing() also raises the vehicle unusual-activity alerts: UNSCHEDULED_STOP,
 * and CREW_LEFT_VEHICLE / ASSET_NOT_DETECTED from the in-cab RFID reader.
 * recordUserPing() tracks people: CREW_AWAY_FROM_VEHICLE when someone's phone
 * is too far from their vehicle. Everything a person does is written to the
 * append-only activity log. What each role may do comes from
 * state.rolePermissions, set by the admin.
 */
import { AT_A_FACILITY, applyCustody, CustodyError, type CustodyStep } from "./custody";
import { LABEL } from "./format";
import { newId } from "./ids";
import { can, withPermission } from "./permissions";
import {
  ARRIVAL_RADIUS_KM,
  crewAwayMessage,
  evaluateRouteDeviation,
  FACILITY_RADIUS_KM,
  kmBetween,
  manifestMismatchMessage,
  parseRoute,
  presenceChange,
  routeDeviationMessage,
  stationarySince,
  stopMessage,
  type DeviationCheck,
  type ManifestReconciliation,
} from "./rules";
import { crewDistance, crewOf, driverOf, find, openTripFor, tripPings, tripReconciliation, userPosition } from "./selectors";
import {
  ActivityKind,
  AlertType,
  AssetState,
  CrewRole,
  CustodyEventType,
  FacilityType,
  PingSource,
  RfidEventKind,
  Role,
  TripState,
  VehicleStatus,
  type ActivityEntry,
  type Alert,
  type ConfigurableRole,
  type CustodyEvent,
  type DemoState,
  type Fix,
  type GpsFix,
  type GpsPing,
  type LatLng,
  type Permission,
  type RfidEvent,
  type Settings,
  type Trip,
  type User,
  type UserPing,
  type Vehicle,
} from "./types";
import { formatTag, isEmail, isEpc, isSaMobile, isSaPlate, normalisePhone, normalisePlate, normaliseTag } from "./validate";

export { ARRIVAL_RADIUS_KM, FACILITY_RADIUS_KM };

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

// ── Permissions ─────────────────────────────────────────────────────────────

const DOING: Record<Permission | "manageUsers", string> = {
  createTrip: "create trips",
  editManifest: "change manifests",
  dispatchTrip: "dispatch trips",
  closeTrip: "close trips",
  acknowledgeAlert: "acknowledge alerts",
  runSimulator: "run the GPS simulator",
  recordCustody: "record hand-offs",
  manageVehicles: "manage vehicles and who is on them",
  trackPeople: "track people",
  manageUsers: "manage users and roles",
};

/** Checks the account as it is now: the admin may have changed its role or deactivated it since sign-in. */
function authorize(s: DemoState, actor: User, permission: Permission | "manageUsers"): void {
  const current = find(s.users, actor.id);
  if (can(s, current, permission)) return;
  if (!current?.active) throw new DomainError("This account has been deactivated.");
  throw new DomainError(`The ${LABEL.role[current.role].toLowerCase()} role can't ${DOING[permission]}.`);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function need<T>(item: T | undefined, what: string): T {
  if (item === undefined) throw new DomainError(`${what} not found`);
  return item;
}

function replace<T extends { id: string }>(list: readonly T[], next: T): T[] {
  return list.map((item) => (item.id === next.id ? next : item));
}

const round7 = (n: number) => Math.round(n * 1e7) / 1e7;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function newAlert(tripId: string, type: AlertType, message: string, at: string, where: Fix | null, userId: string | null = null): Alert {
  return {
    id: newId(),
    tripId,
    type,
    message,
    lat: where ? round7(where.lat) : null,
    lng: where ? round7(where.lng) : null,
    userId,
    acknowledged: false,
    acknowledgedBy: null,
    acknowledgedAt: null,
    createdAt: at,
  };
}

function newRfidEvent(vehicleId: string, tripId: string | null, kind: RfidEventKind, subjectId: string | null, where: Fix, at: string): RfidEvent {
  return { id: newId(), vehicleId, tripId, kind, subjectId, lat: round7(where.lat), lng: round7(where.lng), at };
}

type ActivityRefs = Partial<Pick<ActivityEntry, "tripId" | "assetId" | "vehicleId" | "subjectUserId" | "lat" | "lng">>;
/** A phone location this recent says where someone was when they did something. */
const WHERE_MAX_AGE_MS = 5 * 60_000;

/** Appends to the activity log: who did what, when, and where (given, or their phone's latest location). */
function logged(s: DemoState, actor: User, kind: ActivityKind, summary: string, at: string, refs: ActivityRefs = {}): DemoState {
  let lat = refs.lat ?? null;
  let lng = refs.lng ?? null;
  if (lat === null || lng === null) {
    const last = userPosition(s, actor.id);
    const fresh = last && Math.abs(Date.parse(at) - Date.parse(last.recordedAt)) <= WHERE_MAX_AGE_MS;
    lat = fresh ? last.lat : null;
    lng = fresh ? last.lng : null;
  }
  const entry: ActivityEntry = Object.freeze({
    id: newId(),
    userId: actor.id,
    kind,
    summary,
    tripId: refs.tripId ?? null,
    assetId: refs.assetId ?? null,
    vehicleId: refs.vehicleId ?? null,
    subjectUserId: refs.subjectUserId ?? null,
    lat: lat === null ? null : round7(lat),
    lng: lng === null ? null : round7(lng),
    at,
  });
  return { ...s, activity: [...s.activity, entry] };
}

const placeName = (s: DemoState, facilityId: string | null | undefined) => find(s.facilities, facilityId)?.name ?? "an unknown facility";

// ── Trips ───────────────────────────────────────────────────────────────────

export type NewTrip = { originFacilityId: string; destFacilityId: string; vehicleId: string; plannedRoute: LatLng[] };

export function createTrip(s: DemoState, actor: User, input: NewTrip, now: Date): { state: DemoState; trip: Trip } {
  authorize(s, actor, "createTrip");
  const origin = need(find(s.facilities, input.originFacilityId), "Origin");
  const destination = need(find(s.facilities, input.destFacilityId), "Destination");
  if (origin.id === destination.id) throw new DomainError("Origin and destination must be different");
  const vehicle = need(find(s.vehicles, input.vehicleId), "Vehicle");
  if (vehicle.status === VehicleStatus.OUT_OF_SERVICE) throw new DomainError(`${vehicle.registration} is out of service`);
  if (openTripFor(s, vehicle.id)) throw new DomainError(`${vehicle.registration} is already assigned to an open trip`);
  let plannedRoute: LatLng[];
  try {
    plannedRoute = parseRoute(input.plannedRoute);
  } catch (e) {
    throw new DomainError((e as Error).message);
  }
  const trip: Trip = {
    id: newId(),
    originFacilityId: origin.id,
    destFacilityId: destination.id,
    vehicleId: vehicle.id,
    state: TripState.PLANNED,
    plannedRoute,
    departedAt: null,
    arrivedAt: null,
    closedAt: null,
    createdAt: now.toISOString(),
  };
  const state = logged(
    { ...s, trips: [...s.trips, trip] },
    actor,
    ActivityKind.TRIP,
    `Planned a trip from ${origin.name} to ${destination.name} on ${vehicle.registration}`,
    trip.createdAt,
    { tripId: trip.id, vehicleId: vehicle.id },
  );
  return { state, trip };
}

/** Planning, not custody: marks assets for a PLANNED trip without moving them. */
export function pickAssets(s: DemoState, actor: User, tripId: string, assetIds: string[], now = new Date()): { state: DemoState } {
  authorize(s, actor, "editManifest");
  const trip = need(find(s.trips, tripId), "Trip");
  if (trip.state !== TripState.PLANNED) throw new DomainError("The manifest can only change while the trip is planned");
  let assets = s.assets;
  let added = 0;
  for (const id of assetIds) {
    const asset = need(find(assets, id), "Asset");
    if (asset.currentTripId === tripId) continue;
    if (asset.currentFacilityId !== trip.originFacilityId || !AT_A_FACILITY.includes(asset.state)) {
      throw new DomainError(`${asset.serial} is not at this trip's origin`);
    }
    if (asset.currentTripId) throw new DomainError(`${asset.serial} is already on another trip's manifest`);
    assets = replace(assets, { ...asset, currentTripId: tripId });
    added++;
  }
  if (!added) return { state: s };
  return {
    state: logged({ ...s, assets }, actor, ActivityKind.MANIFEST, `Picked ${plural(added, "asset")} for the trip to ${placeName(s, trip.destFacilityId)}`, now.toISOString(), {
      tripId,
      vehicleId: trip.vehicleId,
    }),
  };
}

export function unpickAsset(s: DemoState, actor: User, tripId: string, assetId: string, now = new Date()): { state: DemoState } {
  authorize(s, actor, "editManifest");
  const trip = need(find(s.trips, tripId), "Trip");
  if (trip.state !== TripState.PLANNED) throw new DomainError("The manifest can only change while the trip is planned");
  const asset = need(find(s.assets, assetId), "Asset");
  if (asset.currentTripId !== tripId) throw new DomainError(`${asset.serial} is not on this manifest`);
  if (asset.state === AssetState.IN_TRANSIT) {
    throw new DomainError(`${asset.serial} is already loaded, and a recorded hand-off can't be undone`);
  }
  return {
    state: logged(
      { ...s, assets: replace(s.assets, { ...asset, currentTripId: null }) },
      actor,
      ActivityKind.MANIFEST,
      `Removed ${asset.serial} from the trip to ${placeName(s, trip.destFacilityId)}`,
      now.toISOString(),
      { tripId, assetId, vehicleId: trip.vehicleId },
    ),
  };
}

export function dispatchTrip(s: DemoState, actor: User, tripId: string, now: Date): { state: DemoState } {
  authorize(s, actor, "dispatchTrip");
  const trip = need(find(s.trips, tripId), "Trip");
  if (trip.state !== TripState.PLANNED) throw new DomainError("Only a planned trip can be dispatched");
  const vehicle = need(find(s.vehicles, trip.vehicleId), "Vehicle");
  if (vehicle.status === VehicleStatus.OUT_OF_SERVICE) throw new DomainError(`${vehicle.registration} is out of service`);
  if (!driverOf(s, vehicle.id)) throw new DomainError(`Assign a driver to ${vehicle.registration} before dispatch`);
  const onManifest = s.assets.filter((a) => a.currentTripId === tripId);
  if (!onManifest.some((a) => a.state === AssetState.IN_TRANSIT)) throw new DomainError("Nothing has been loaded yet");
  const notLoaded = onManifest.filter((a) => a.state !== AssetState.IN_TRANSIT);
  if (notLoaded.length) {
    const n = notLoaded.length;
    throw new DomainError(`Load or remove ${n} picked asset${n === 1 ? "" : "s"} before dispatch: ${notLoaded.map((a) => a.serial).join(", ")}`);
  }
  const at = now.toISOString();
  const origin = need(find(s.facilities, trip.originFacilityId), "Origin");
  const crew = crewOf(s, vehicle.id);
  // The in-cab reader's first read at the gate: everyone assigned and everything loaded.
  const onboard = { crewIds: crew.map((c) => c.id), assetIds: onManifest.map((a) => a.id), readAt: at, lat: origin.lat, lng: origin.lng };
  const dispatched: DemoState = {
    ...s,
    trips: replace(s.trips, { ...trip, state: TripState.IN_TRANSIT, departedAt: at }),
    vehicles: replace(s.vehicles, { ...vehicle, status: VehicleStatus.ON_TRIP, onboard }),
    rfidEvents: [...s.rfidEvents, newRfidEvent(vehicle.id, trip.id, RfidEventKind.GATE_OUT, null, origin, at)],
  };
  return {
    state: logged(
      dispatched,
      actor,
      ActivityKind.TRIP,
      `Dispatched ${vehicle.registration} to ${placeName(s, trip.destFacilityId)} with ${plural(onManifest.length, "asset")} and ${crew.length} crew (${crew.map((c) => c.name).join(", ")})`,
      at,
      { tripId, vehicleId: vehicle.id },
    ),
  };
}

/** Rule 2: close only when every asset loaded at origin was received at destination. */
export function closeTrip(
  s: DemoState,
  actor: User,
  tripId: string,
  now: Date,
): { state: DemoState; closed: boolean; reconciliation: ManifestReconciliation; alert: Alert | null } {
  authorize(s, actor, "closeTrip");
  const trip = need(find(s.trips, tripId), "Trip");
  if (trip.state !== TripState.ARRIVED) {
    throw new DomainError(trip.state === TripState.CLOSED ? "This trip is already closed" : "A trip can only close after it has arrived");
  }
  const at = now.toISOString();
  const reconciliation = tripReconciliation(s, tripId);
  const dest = placeName(s, trip.destFacilityId);
  const refs = { tripId, vehicleId: trip.vehicleId };

  if (!reconciliation.balanced) {
    const summary = `Tried to close the trip to ${dest}: blocked, ${reconciliation.received.length} of ${reconciliation.loaded.length} received`;
    const message = manifestMismatchMessage(reconciliation, (id) => find(s.assets, id)?.serial ?? id);
    const existing = s.alerts.find(
      (a) => a.tripId === tripId && a.type === AlertType.MANIFEST_MISMATCH && !a.acknowledged && a.message === message,
    );
    if (existing) return { state: logged(s, actor, ActivityKind.TRIP, summary, at, refs), closed: false, reconciliation, alert: existing };
    const alert = newAlert(tripId, AlertType.MANIFEST_MISMATCH, message, at, null);
    return { state: logged({ ...s, alerts: [...s.alerts, alert] }, actor, ActivityKind.TRIP, summary, at, refs), closed: false, reconciliation, alert };
  }

  const vehicle = need(find(s.vehicles, trip.vehicleId), "Vehicle");
  const closed: DemoState = {
    ...s,
    trips: replace(s.trips, { ...trip, state: TripState.CLOSED, closedAt: at }),
    vehicles: replace(s.vehicles, { ...vehicle, status: VehicleStatus.AVAILABLE, onboard: null }),
  };
  return {
    state: logged(closed, actor, ActivityKind.TRIP, `Closed the trip to ${dest}: all ${plural(reconciliation.loaded.length, "asset")} received`, at, refs),
    closed: true,
    reconciliation,
    alert: null,
  };
}

// ── Custody (rule 1: append-only) ───────────────────────────────────────────

export type HandoffInput = {
  assetId: string;
  type: CustodyEventType;
  /** LOAD: which planned trip (defaults to the one the asset is picked for). */
  tripId?: string | null;
  /** INTAKE: which warehouse. */
  toFacilityId?: string | null;
  sealNumber?: string | null;
  gps: GpsFix;
};

/** One hand-off, without the permission check or the activity log (the callers below add both). */
function custodyStep(s: DemoState, actor: User, input: HandoffInput, now: Date): { state: DemoState; event: CustodyEvent } {
  const asset = need(find(s.assets, input.assetId), "Asset");
  if (!Number.isFinite(input.gps.lat) || !Number.isFinite(input.gps.lng)) throw new DomainError("A hand-off needs GPS coordinates");
  const seal = input.sealNumber?.trim().toUpperCase() || null;
  let trips = s.trips;
  let step: CustodyStep;
  let custodian: string | null;

  switch (input.type) {
    case CustodyEventType.INTAKE: {
      const warehouse = need(find(s.facilities, input.toFacilityId), "Warehouse");
      if (warehouse.type !== FacilityType.WAREHOUSE) throw new DomainError("Intake is into a warehouse");
      step = { type: CustodyEventType.INTAKE, toFacilityId: warehouse.id };
      custodian = actor.name;
      break;
    }
    case CustodyEventType.LOAD: {
      const trip = need(find(s.trips, input.tripId ?? asset.currentTripId), "A planned trip for this load");
      if (trip.state !== TripState.PLANNED) throw new DomainError("Assets can only be loaded onto a planned trip");
      if (!seal) throw new DomainError("Enter the seal number before loading");
      const vehicle = need(find(s.vehicles, trip.vehicleId), "Vehicle");
      step = { type: CustodyEventType.LOAD, tripId: trip.id, fromFacilityId: trip.originFacilityId };
      // Once loaded, the driver holds it.
      custodian = driverOf(s, vehicle.id)?.name ?? `${vehicle.registration} crew`;
      break;
    }
    case CustodyEventType.RECEIVE: {
      const trip = find(s.trips, asset.currentTripId);
      if (asset.state !== AssetState.IN_TRANSIT || !trip) throw new DomainError(`${asset.serial} is not in transit`);
      if (trip.state === TripState.PLANNED) throw new DomainError("This trip hasn't been dispatched yet");
      if (!seal) throw new DomainError("Enter the seal number found on arrival");
      const origin = need(find(s.facilities, trip.originFacilityId), "Origin");
      const destination = need(find(s.facilities, trip.destFacilityId), "Destination");
      step = {
        type: CustodyEventType.RECEIVE,
        tripId: trip.id,
        toFacilityId: destination.id,
        toFacilityType: destination.type,
        tripOriginType: origin.type,
      };
      custodian = actor.name;
      // The first receipt at the destination means the vehicle has arrived.
      if (trip.state === TripState.IN_TRANSIT) {
        trips = replace(trips, { ...trip, state: TripState.ARRIVED, arrivedAt: now.toISOString() });
      }
      break;
    }
    case CustodyEventType.REPORT_MISSING:
      step = { type: CustodyEventType.REPORT_MISSING };
      custodian = null;
      break;
    default:
      throw new DomainError("Unknown hand-off type");
  }

  let applied: ReturnType<typeof applyCustody>;
  try {
    applied = applyCustody(
      { state: asset.state, currentFacilityId: asset.currentFacilityId, currentTripId: asset.currentTripId },
      step,
    );
  } catch (e) {
    if (e instanceof CustodyError) throw new DomainError(`${asset.serial}: ${e.message}`);
    throw e;
  }

  const event: CustodyEvent = Object.freeze({
    id: newId(),
    type: step.type,
    assetId: asset.id,
    ...applied.columns,
    officerId: actor.id,
    officerName: actor.name,
    custodian,
    sealNumber: seal,
    lat: round7(input.gps.lat),
    lng: round7(input.gps.lng),
    gpsAccuracyM: input.gps.accuracyM,
    gpsSource: input.gps.source,
    createdAt: now.toISOString(),
  });

  return {
    state: {
      ...s,
      trips,
      assets: replace(s.assets, { ...asset, ...applied.after }),
      custodyEvents: [...s.custodyEvents, event],
    },
    event,
  };
}

/** "Loaded 10 assets onto CP 77 WD GP (seal SL-300001)" */
function handoffSummary(s: DemoState, events: CustodyEvent[]): string {
  const e = events[0];
  const what = events.length === 1 ? (find(s.assets, e.assetId)?.serial ?? "an asset") : `${events.length} assets`;
  const trip = find(s.trips, e.tripId);
  const vehicle = trip ? find(s.vehicles, trip.vehicleId)?.registration : undefined;
  switch (e.type) {
    case CustodyEventType.LOAD:
      return `Loaded ${what} onto ${vehicle}${e.sealNumber ? ` (seal ${e.sealNumber})` : ""}`;
    case CustodyEventType.RECEIVE:
      return `Received ${what} at ${placeName(s, e.toFacilityId)} off ${vehicle}`;
    case CustodyEventType.INTAKE:
      return `Booked ${what} into ${placeName(s, e.toFacilityId)}`;
    default:
      return `Reported ${what} missing`;
  }
}

function withHandoffLog(s: DemoState, actor: User, events: CustodyEvent[], now: Date): DemoState {
  const first = events[0];
  return logged(s, actor, ActivityKind.HANDOFF, handoffSummary(s, events), now.toISOString(), {
    tripId: first.tripId,
    assetId: events.length === 1 ? first.assetId : null,
    vehicleId: find(s.trips, first.tripId)?.vehicleId ?? null,
    lat: first.lat,
    lng: first.lng,
  });
}

export function recordCustody(s: DemoState, actor: User, input: HandoffInput, now: Date): { state: DemoState; event: CustodyEvent } {
  authorize(s, actor, "recordCustody");
  const { state, event } = custodyStep(s, actor, input, now);
  return { state: withHandoffLog(state, actor, [event], now), event };
}

/** Several hand-offs as one all-or-nothing batch (bulk load or receive), logged as one activity. */
export function recordCustodyBatch(
  s: DemoState,
  actor: User,
  inputs: HandoffInput[],
  now: Date,
): { state: DemoState; events: CustodyEvent[] } {
  authorize(s, actor, "recordCustody");
  if (!inputs.length) throw new DomainError("Select at least one asset");
  let state = s;
  const events: CustodyEvent[] = [];
  for (const input of inputs) {
    const result = custodyStep(state, actor, input, now);
    state = result.state;
    events.push(result.event);
  }
  return { state: withHandoffLog(state, actor, events, now), events };
}

// ── GPS and RFID: rule 3 plus the unusual-activity alerts ───────────────────

/** What the in-cab RFID reader reports with a ping: the crew badges and asset tags it can see. */
export type ReaderSnapshot = { crewIds: string[]; assetIds: string[] };

export type PingResult = {
  state: DemoState;
  check: DeviationCheck;
  /** How long the vehicle has been standing still at this spot. */
  stoppedMinutes: number;
  alerts: Alert[];
  arrived: boolean;
};

const dutyOf = (u: User) => (u.duty ? LABEL.crewRole[u.duty].toLowerCase() : "crew");

export function recordPing(s: DemoState, tripId: string, fix: Fix, now: Date, reader?: ReaderSnapshot): PingResult {
  const trip = need(find(s.trips, tripId), "Trip");
  if (trip.state !== TripState.IN_TRANSIT) throw new DomainError("GPS pings are only accepted for trips in transit");
  const vehicle = need(find(s.vehicles, trip.vehicleId), "Vehicle");
  const origin = need(find(s.facilities, trip.originFacilityId), "Origin");
  const destination = need(find(s.facilities, trip.destFacilityId), "Destination");
  const at = now.toISOString();
  const earlier = tripPings(s, tripId);
  const nearFacility = kmBetween(fix, origin) <= FACILITY_RADIUS_KM || kmBetween(fix, destination) <= FACILITY_RADIUS_KM;
  const alerts: Alert[] = [];
  const rfidEvents: RfidEvent[] = [];

  // Rule 3: more than 2 km off the planned route.
  const check = evaluateRouteDeviation(trip.plannedRoute, fix, earlier[earlier.length - 1] ?? null);
  if (check.raiseAlert) {
    alerts.push(newAlert(tripId, AlertType.ROUTE_DEVIATION, routeDeviationMessage(vehicle.registration, check.distanceKm, destination.name), at, fix));
  }

  // Standing still away from any facility for longer than the admin's limit: one alert per stop.
  const since = stationarySince(earlier, { ...fix, recordedAt: at });
  const stoppedMinutes = (now.getTime() - Date.parse(since)) / 60_000;
  const limit = s.settings.stopAlertMinutes;
  const alreadyRaised = s.alerts.some((a) => a.tripId === tripId && a.type === AlertType.UNSCHEDULED_STOP && a.createdAt >= since);
  if (!nearFacility && stoppedMinutes >= limit && !alreadyRaised) {
    alerts.push(newAlert(tripId, AlertType.UNSCHEDULED_STOP, stopMessage(vehicle.registration, stoppedMinutes, fix, limit), at, fix));
  }

  // RFID: what the in-cab reader sees now against its previous read.
  let vehicles = s.vehicles;
  if (reader) {
    const before = vehicle.onboard ?? { crewIds: [], assetIds: [] };
    const crew = presenceChange(before.crewIds, reader.crewIds);
    const tags = presenceChange(before.assetIds, reader.assetIds);
    const crewTotal = crewOf(s, vehicle.id).length;
    const loaded = s.assets.filter((a) => a.currentTripId === tripId && a.state === AssetState.IN_TRANSIT);

    for (const id of crew.left) {
      rfidEvents.push(newRfidEvent(vehicle.id, tripId, RfidEventKind.CREW_OFF, id, fix, at));
      const member = find(s.users, id);
      if (!nearFacility && member) {
        alerts.push(
          newAlert(
            tripId,
            AlertType.CREW_LEFT_VEHICLE,
            `${member.name} (${dutyOf(member)}) left ${vehicle.registration} away from any facility: their RFID badge is no longer read on board. ${reader.crewIds.length} of ${crewTotal} crew still on board.`,
            at,
            fix,
            member.id,
          ),
        );
      }
    }
    for (const id of crew.returned) rfidEvents.push(newRfidEvent(vehicle.id, tripId, RfidEventKind.CREW_ON, id, fix, at));

    for (const id of tags.left) {
      rfidEvents.push(newRfidEvent(vehicle.id, tripId, RfidEventKind.ASSET_MISSING, id, fix, at));
      const asset = loaded.find((a) => a.id === id);
      if (!nearFacility && asset) {
        alerts.push(
          newAlert(
            tripId,
            AlertType.ASSET_NOT_DETECTED,
            `${asset.serial} is no longer detected by ${vehicle.registration}'s RFID reader. ${reader.assetIds.length} of ${loaded.length} loaded assets still detected.`,
            at,
            fix,
          ),
        );
      }
    }
    for (const id of tags.returned) rfidEvents.push(newRfidEvent(vehicle.id, tripId, RfidEventKind.ASSET_FOUND, id, fix, at));

    vehicles = replace(vehicles, {
      ...vehicle,
      onboard: { crewIds: [...reader.crewIds], assetIds: [...reader.assetIds], readAt: at, lat: round7(fix.lat), lng: round7(fix.lng) },
    });
  }

  const arrived = kmBetween(fix, destination) <= ARRIVAL_RADIUS_KM;
  if (arrived) rfidEvents.push(newRfidEvent(vehicle.id, tripId, RfidEventKind.GATE_IN, null, destination, at));

  const ping: GpsPing = { id: newId(), tripId, lat: round7(fix.lat), lng: round7(fix.lng), recordedAt: at };
  return {
    state: {
      ...s,
      vehicles,
      gpsPings: [...s.gpsPings, ping],
      rfidEvents: rfidEvents.length ? [...s.rfidEvents, ...rfidEvents] : s.rfidEvents,
      alerts: alerts.length ? [...s.alerts, ...alerts] : s.alerts,
      trips: arrived ? replace(s.trips, { ...trip, state: TripState.ARRIVED, arrivedAt: at }) : s.trips,
    },
    check,
    stoppedMinutes,
    alerts,
    arrived,
  };
}

// ── Alerts ──────────────────────────────────────────────────────────────────

export function acknowledgeAlert(s: DemoState, actor: User, alertId: string, now: Date): { state: DemoState } {
  authorize(s, actor, "acknowledgeAlert");
  const alert = need(find(s.alerts, alertId), "Alert");
  if (alert.acknowledged) return { state: s };
  const at = now.toISOString();
  const trip = find(s.trips, alert.tripId);
  const vehicle = trip ? find(s.vehicles, trip.vehicleId) : undefined;
  const about = find(s.users, alert.userId);
  return {
    state: logged(
      { ...s, alerts: replace(s.alerts, { ...alert, acknowledged: true, acknowledgedBy: actor.name, acknowledgedAt: at }) },
      actor,
      ActivityKind.ALERT,
      `Acknowledged ${LABEL.alertType[alert.type].toLowerCase()} on ${vehicle?.registration ?? "a trip"}${about ? ` (${about.name})` : ""}`,
      at,
      { tripId: alert.tripId, vehicleId: vehicle?.id ?? null, subjectUserId: about?.id ?? null },
    ),
  };
}

// ── Vehicles and RFID ───────────────────────────────────────────────────────

/** Every tag and badge must be unique across vehicles, people and assets. */
function assertTagFree(s: DemoState, tag: string, exceptId?: string): void {
  const holders: [id: string, tag: string | null, name: string][] = [
    ...s.vehicles.map((v): [string, string, string] => [v.id, v.rfidTag, v.registration]),
    ...s.users.map((u): [string, string | null, string] => [u.id, u.rfidBadge, u.name]),
    ...s.assets.map((a): [string, string, string] => [a.id, a.rfidTag, a.serial]),
  ];
  const holder = holders.find(([id, t]) => t === tag && id !== exceptId);
  if (holder) throw new DomainError(`RFID ${formatTag(tag)} already belongs to ${holder[2]}`);
}

export type VehicleInput = { registration: string; rfidTag: string; readerId: string; seats: number };

function cleanVehicle(s: DemoState, input: VehicleInput, exceptId?: string): VehicleInput {
  const registration = normalisePlate(input.registration);
  if (!isSaPlate(registration)) {
    throw new DomainError(`"${registration}" isn't a South African number plate (for example JK 21 LM GP or CA 123-456)`);
  }
  if (s.vehicles.some((v) => v.registration === registration && v.id !== exceptId)) {
    throw new DomainError(`${registration} is already registered`);
  }
  const rfidTag = normaliseTag(input.rfidTag);
  if (!isEpc(rfidTag)) throw new DomainError("An RFID tag is 24 hexadecimal characters (a 96-bit EPC)");
  assertTagFree(s, rfidTag, exceptId);
  const readerId = input.readerId.trim().toUpperCase();
  if (!readerId) throw new DomainError("Enter the in-cab reader's ID");
  if (s.vehicles.some((v) => v.readerId === readerId && v.id !== exceptId)) {
    throw new DomainError(`Reader ${readerId} is already fitted to another vehicle`);
  }
  const seats = Math.floor(Number(input.seats));
  if (!(seats >= 1 && seats <= 60)) throw new DomainError("Seats must be between 1 and 60");
  return { registration, rfidTag, readerId, seats };
}

export function createVehicle(s: DemoState, actor: User, input: VehicleInput, now = new Date()): { state: DemoState; vehicle: Vehicle } {
  authorize(s, actor, "manageVehicles");
  const vehicle: Vehicle = { id: newId(), ...cleanVehicle(s, input), status: VehicleStatus.AVAILABLE, onboard: null };
  const state = logged(
    { ...s, vehicles: [...s.vehicles, vehicle] },
    actor,
    ActivityKind.VEHICLE,
    `Added ${vehicle.registration} (${vehicle.seats} seats, reader ${vehicle.readerId})`,
    now.toISOString(),
    { vehicleId: vehicle.id },
  );
  return { state, vehicle };
}

export function updateVehicle(
  s: DemoState,
  actor: User,
  vehicleId: string,
  input: VehicleInput & { outOfService: boolean },
  now = new Date(),
): { state: DemoState } {
  authorize(s, actor, "manageVehicles");
  const vehicle = need(find(s.vehicles, vehicleId), "Vehicle");
  const clean = cleanVehicle(s, input, vehicleId);
  const people = crewOf(s, vehicleId).length;
  if (clean.seats < people) throw new DomainError(`${people} people are assigned to ${vehicle.registration}, so it needs at least ${people} seats`);
  let status = vehicle.status;
  if (vehicle.status === VehicleStatus.ON_TRIP) {
    if (input.outOfService) throw new DomainError(`${vehicle.registration} is on the road`);
  } else {
    if (input.outOfService && openTripFor(s, vehicleId)) throw new DomainError(`${vehicle.registration} is assigned to an open trip`);
    status = input.outOfService ? VehicleStatus.OUT_OF_SERVICE : VehicleStatus.AVAILABLE;
  }
  const summary =
    status === vehicle.status
      ? `Updated ${clean.registration}`
      : status === VehicleStatus.OUT_OF_SERVICE
        ? `Took ${clean.registration} out of service`
        : `Returned ${clean.registration} to service`;
  return {
    state: logged({ ...s, vehicles: replace(s.vehicles, { ...vehicle, ...clean, status }) }, actor, ActivityKind.VEHICLE, summary, now.toISOString(), {
      vehicleId,
    }),
  };
}

// ── Who is on which vehicle ─────────────────────────────────────────────────

const onTheRoad = (s: DemoState, vehicleId: string | null) =>
  !!vehicleId && s.trips.some((t) => t.vehicleId === vehicleId && t.state === TripState.IN_TRANSIT);

/**
 * Puts a person on a vehicle with a duty, moves them to another vehicle or
 * duty, or takes them off (vehicleId null). Seats are enforced, a vehicle has
 * one driver, and nothing changes while either vehicle is on the road.
 */
export function assignToVehicle(
  s: DemoState,
  actor: User,
  userId: string,
  vehicleId: string | null,
  duty: CrewRole | null,
  now = new Date(),
): { state: DemoState } {
  authorize(s, actor, "manageVehicles");
  const at = now.toISOString();
  const person = need(find(s.users, userId), "Person");
  if (!person.active) throw new DomainError(`${person.name}'s account is deactivated`);
  const current = find(s.vehicles, person.vehicleId);
  if (current && onTheRoad(s, current.id)) {
    throw new DomainError(`${person.name} is on the road in ${current.registration}; change who is on it once it has arrived`);
  }

  if (!vehicleId) {
    if (!current) return { state: s };
    return {
      state: logged(
        { ...s, users: replace(s.users, { ...person, vehicleId: null, duty: null }) },
        actor,
        ActivityKind.ASSIGNMENT,
        `Took ${person.name} off ${current.registration}`,
        at,
        { vehicleId: current.id, subjectUserId: person.id },
      ),
    };
  }

  const vehicle = need(find(s.vehicles, vehicleId), "Vehicle");
  if (!duty) throw new DomainError(`Choose ${person.name}'s duty on ${vehicle.registration}`);
  if (onTheRoad(s, vehicle.id)) throw new DomainError(`${vehicle.registration} is on the road; change who is on it once it has arrived`);
  if (current?.id === vehicle.id && person.duty === duty) return { state: s };
  const others = crewOf(s, vehicle.id).filter((c) => c.id !== person.id);
  if (others.length >= vehicle.seats) throw new DomainError(`All ${vehicle.seats} seats in ${vehicle.registration} are taken`);
  const driver = others.find((c) => c.duty === CrewRole.DRIVER);
  if (duty === CrewRole.DRIVER && driver) throw new DomainError(`${vehicle.registration} already has a driver: ${driver.name}`);

  const as = LABEL.crewRole[duty].toLowerCase();
  const summary =
    current?.id === vehicle.id
      ? `Changed ${person.name}'s duty on ${vehicle.registration} to ${as}`
      : current
        ? `Moved ${person.name} from ${current.registration} to ${vehicle.registration} as ${as}`
        : `Assigned ${person.name} to ${vehicle.registration} as ${as}`;
  return {
    state: logged({ ...s, users: replace(s.users, { ...person, vehicleId: vehicle.id, duty }) }, actor, ActivityKind.ASSIGNMENT, summary, at, {
      vehicleId: vehicle.id,
      subjectUserId: person.id,
    }),
  };
}

// ── Users, roles and settings (admins only) ─────────────────────────────────

export type UserInput = {
  name: string;
  email: string;
  role: Role;
  password: string;
  phone?: string;
  rfidBadge?: string;
  vehicleId?: string | null;
  duty?: CrewRole | null;
};
export type UserDetails = { name: string; email: string; phone: string; rfidBadge: string };

const activeAdmins = (s: DemoState) => s.users.filter((u) => u.active && u.role === Role.ADMIN);

function cleanName(input: string): string {
  const name = input.trim().replace(/\s+/g, " ");
  if (name.length < 2) throw new DomainError("Enter the person's full name");
  return name;
}

function cleanEmail(s: DemoState, input: string, exceptId?: string): string {
  const email = input.trim().toLowerCase();
  if (!isEmail(email)) throw new DomainError("Enter a valid email address");
  if (s.users.some((u) => u.email === email && u.id !== exceptId)) throw new DomainError(`${email} already has an account`);
  return email;
}

function cleanPhone(input: string | undefined): string | null {
  if (!input?.trim()) return null;
  const phone = normalisePhone(input);
  if (!isSaMobile(phone)) throw new DomainError("Use a South African mobile number, for example 082 123 4567");
  return phone;
}

function cleanBadge(s: DemoState, input: string | undefined, exceptId?: string): string | null {
  if (!input?.trim()) return null;
  const badge = normaliseTag(input);
  if (!isEpc(badge)) throw new DomainError("An RFID badge is 24 hexadecimal characters (a 96-bit EPC)");
  assertTagFree(s, badge, exceptId);
  return badge;
}

export function createUser(s: DemoState, actor: User, input: UserInput, now = new Date()): { state: DemoState; user: User } {
  authorize(s, actor, "manageUsers");
  const name = cleanName(input.name);
  const email = cleanEmail(s, input.email);
  if (input.password.length < 8) throw new DomainError("Use a password of at least 8 characters");
  const user: User = {
    id: newId(),
    name,
    email,
    role: input.role,
    password: input.password,
    active: true,
    phone: cleanPhone(input.phone),
    rfidBadge: cleanBadge(s, input.rfidBadge),
    vehicleId: null,
    duty: null,
  };
  let state = logged({ ...s, users: [...s.users, user] }, actor, ActivityKind.ACCOUNT, `Added ${name} as ${LABEL.role[user.role].toLowerCase()}`, now.toISOString(), {
    subjectUserId: user.id,
  });
  if (input.vehicleId) state = assignToVehicle(state, actor, user.id, input.vehicleId, input.duty ?? null, now).state;
  return { state, user: find(state.users, user.id)! };
}

export function updateUser(s: DemoState, actor: User, userId: string, input: UserDetails, now = new Date()): { state: DemoState } {
  authorize(s, actor, "manageUsers");
  const user = need(find(s.users, userId), "User");
  const next: User = {
    ...user,
    name: cleanName(input.name),
    email: cleanEmail(s, input.email, user.id),
    phone: cleanPhone(input.phone),
    rfidBadge: cleanBadge(s, input.rfidBadge, user.id),
  };
  return {
    state: logged({ ...s, users: replace(s.users, next) }, actor, ActivityKind.ACCOUNT, `Updated ${next.name}'s details`, now.toISOString(), {
      subjectUserId: user.id,
    }),
  };
}

export function setUserRole(s: DemoState, actor: User, userId: string, role: Role, now = new Date()): { state: DemoState } {
  authorize(s, actor, "manageUsers");
  const user = need(find(s.users, userId), "User");
  if (user.role === role) return { state: s };
  if (user.role === Role.ADMIN && user.active && activeAdmins(s).length === 1) {
    throw new DomainError("There must always be at least one active admin");
  }
  return {
    state: logged(
      { ...s, users: replace(s.users, { ...user, role }) },
      actor,
      ActivityKind.ACCOUNT,
      `Changed ${user.name}'s role from ${LABEL.role[user.role].toLowerCase()} to ${LABEL.role[role].toLowerCase()}`,
      now.toISOString(),
      { subjectUserId: user.id },
    ),
  };
}

/** Deactivating takes the person off their vehicle; not while it's on the road. */
export function setUserActive(s: DemoState, actor: User, userId: string, active: boolean, now = new Date()): { state: DemoState } {
  authorize(s, actor, "manageUsers");
  const user = need(find(s.users, userId), "User");
  if (user.active === active) return { state: s };
  if (!active && user.id === actor.id) throw new DomainError("You can't deactivate your own account");
  if (!active && user.role === Role.ADMIN && activeAdmins(s).length === 1) {
    throw new DomainError("There must always be at least one active admin");
  }
  const vehicle = find(s.vehicles, user.vehicleId);
  if (!active && vehicle && onTheRoad(s, vehicle.id)) {
    throw new DomainError(`${user.name} is on the road in ${vehicle.registration}; deactivate the account once it has arrived`);
  }
  const next: User = active ? { ...user, active } : { ...user, active, vehicleId: null, duty: null };
  const summary = active
    ? `Reactivated ${user.name}'s account`
    : `Deactivated ${user.name}'s account${vehicle ? ` and took them off ${vehicle.registration}` : ""}`;
  return {
    state: logged({ ...s, users: replace(s.users, next) }, actor, ActivityKind.ACCOUNT, summary, now.toISOString(), {
      subjectUserId: user.id,
      vehicleId: vehicle?.id ?? null,
    }),
  };
}

export function setRolePermission(
  s: DemoState,
  actor: User,
  role: ConfigurableRole,
  permission: Permission,
  allowed: boolean,
  now = new Date(),
): { state: DemoState } {
  authorize(s, actor, "manageUsers");
  if (s.rolePermissions[role].includes(permission) === allowed) return { state: s };
  return {
    state: logged(
      { ...s, rolePermissions: { ...s.rolePermissions, [role]: withPermission(s.rolePermissions[role], permission, allowed) } },
      actor,
      ActivityKind.SETTINGS,
      `${LABEL.role[role]}s may ${allowed ? "now" : "no longer"} ${DOING[permission]}`,
      now.toISOString(),
    ),
  };
}

export function updateSettings(s: DemoState, actor: User, settings: Partial<Settings>, now = new Date()): { state: DemoState } {
  authorize(s, actor, "manageUsers");
  const merged = { ...s.settings, ...settings };
  const minutes = Number(merged.stopAlertMinutes);
  if (!(minutes >= 0.5 && minutes <= 120)) throw new DomainError("The stop limit must be between 0.5 and 120 minutes");
  const metres = Number(merged.crewAwayMetres);
  if (!(metres >= 20 && metres <= 5000)) throw new DomainError("The crew distance limit must be between 20 and 5,000 metres");
  const next: Settings = { stopAlertMinutes: Math.round(minutes * 10) / 10, crewAwayMetres: Math.round(metres) };
  return {
    state: logged(
      { ...s, settings: next },
      actor,
      ActivityKind.SETTINGS,
      `Set the alert rules: unscheduled stop after ${next.stopAlertMinutes} min, crew away from their vehicle beyond ${next.crewAwayMetres} m`,
      now.toISOString(),
    ),
  };
}

// ── People: where they are, and when they sign in ────────────────────────────

export type UserPingResult = { state: DemoState; ping: UserPing; alert: Alert | null };

/**
 * A person's phone reports where they are (the app shares it while they're
 * signed in; the simulator stands in for the crew's phones). While their
 * vehicle is on the road this raises CREW_AWAY_FROM_VEHICLE when they go from
 * within the admin's distance limit to beyond it: once per excursion, like
 * route deviation, so coming back and wandering off again raises a new one.
 */
export function recordUserPing(
  s: DemoState,
  userId: string,
  fix: Fix & { accuracyM?: number | null },
  now: Date,
  source: PingSource = PingSource.PHONE,
): UserPingResult {
  const user = need(find(s.users, userId), "Person");
  if (!user.active) throw new DomainError("This account has been deactivated.");
  if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) throw new DomainError("A location needs coordinates");
  const at = now.toISOString();
  const gap = crewDistance(s, user, fix);
  const previous = userPosition(s, user.id);
  const wasAway = !!gap && previous?.tripId === gap.trip.id && !!previous?.away;
  const ping: UserPing = {
    id: newId(),
    userId: user.id,
    lat: round7(fix.lat),
    lng: round7(fix.lng),
    accuracyM: fix.accuracyM ?? null,
    source,
    tripId: gap?.trip.id ?? null,
    vehicleDistanceM: gap ? Math.round(gap.km * 1000) : null,
    away: !!gap?.away,
    recordedAt: at,
  };

  let alert: Alert | null = null;
  if (gap?.away && !wasAway) {
    const crew = crewOf(s, gap.vehicle.id);
    const withVehicle = crew.filter((c) => {
      if (c.id === user.id) return false;
      const last = userPosition(s, c.id);
      return !(last?.tripId === gap.trip.id && last.away);
    }).length;
    alert = newAlert(
      gap.trip.id,
      AlertType.CREW_AWAY_FROM_VEHICLE,
      crewAwayMessage({
        name: user.name,
        duty: dutyOf(user),
        registration: gap.vehicle.registration,
        metres: gap.km * 1000,
        limitMetres: gap.limitKm * 1000,
        facilityName: gap.facility?.name ?? null,
        onBoard: withVehicle,
        crewTotal: crew.length,
      }),
      at,
      fix,
      user.id,
    );
  }

  return {
    state: { ...s, userPings: [...s.userPings, ping], alerts: alert ? [...s.alerts, alert] : s.alerts },
    ping,
    alert,
  };
}

/** Sign-ins and sign-outs go in the activity log, so anyone's day can be traced. */
export function recordSession(s: DemoState, userId: string, signedIn: boolean, now: Date): { state: DemoState } {
  const user = need(find(s.users, userId), "Person");
  return { state: logged(s, user, ActivityKind.SESSION, signedIn ? "Signed in" : "Signed out", now.toISOString()) };
}
