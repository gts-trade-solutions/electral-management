/**
 * The rules that make BallotRoute worth demoing. Pure functions, no I/O, so the
 * app, the seed and the GPS simulator all apply them identically.
 *
 *   Rule 1  custody events are append-only   enforced in lib/domain.ts
 *   Rule 2  manifest reconciliation          reconcileManifest()
 *   Rule 3  route deviation beyond 2 km      evaluateRouteDeviation()
 *
 * The unusual-activity checks live here too: unscheduled stops
 * (stationarySince), RFID presence on board (presenceChange) and crew
 * straying from their vehicle (crewAwayLimitKm).
 */
import { distance, lineString, point, pointToLineDistance } from "@turf/turf";
import type { Feature, LineString } from "geojson";
import type { Fix, LatLng } from "./types";

export const ROUTE_DEVIATION_KM = 2;
/** A ping this close to the destination marks the trip ARRIVED. */
export const ARRIVAL_RADIUS_KM = 0.2;
/** Stepping out, a tag going quiet or standing still this close to a facility is routine (gates, loading, offloading). */
export const FACILITY_RADIUS_KM = 0.3;

// ── Geometry ────────────────────────────────────────────────────────────────

/** The one place [lat, lng] becomes GeoJSON's [lng, lat]. */
export function toLngLat([lat, lng]: LatLng): [number, number] {
  return [lng, lat];
}

export function routeLine(route: LatLng[]): Feature<LineString> {
  if (route.length < 2) throw new Error("A planned route needs at least two points");
  return lineString(route.map(toLngLat));
}

export function distanceFromRouteKm(route: LatLng[] | Feature<LineString>, fix: Fix): number {
  const line = Array.isArray(route) ? routeLine(route) : route;
  return pointToLineDistance(point([fix.lng, fix.lat]), line, { units: "kilometers" });
}

export function kmBetween(a: Fix, b: Fix): number {
  return distance([a.lng, a.lat], [b.lng, b.lat], { units: "kilometers" });
}

/** Validates a planned route into [lat, lng] pairs. */
export function parseRoute(value: unknown): LatLng[] {
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error("A planned route must be at least two [lat, lng] pairs");
  }
  return value.map((pair, i) => {
    if (!Array.isArray(pair) || pair.length !== 2) throw new Error(`Route point ${i} is not a [lat, lng] pair`);
    const [lat, lng] = pair.map(Number);
    if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) {
      throw new Error(`Route point ${i} is out of range: [${pair.join(", ")}]`);
    }
    return [lat, lng] as LatLng;
  });
}

// ── Rule 3: route deviation ─────────────────────────────────────────────────

export type DeviationCheck = { distanceKm: number; offRoute: boolean; raiseAlert: boolean };

/**
 * Edge-triggered: raise an alert when a ping crosses from inside the 2 km
 * corridor to outside it, or when a trip's first ping is already outside.
 * A vehicle that stays off-route raises one alert, not one per ping;
 * rejoining the route and leaving it again raises a new one.
 */
export function evaluateRouteDeviation(route: LatLng[], current: Fix, previous: Fix | null): DeviationCheck {
  const line = routeLine(route);
  const distanceKm = distanceFromRouteKm(line, current);
  const offRoute = distanceKm > ROUTE_DEVIATION_KM;
  const wasOffRoute = previous !== null && distanceFromRouteKm(line, previous) > ROUTE_DEVIATION_KM;
  return { distanceKm, offRoute, raiseAlert: offRoute && !wasOffRoute };
}

export function routeDeviationMessage(registration: string, distanceKm: number, destinationName: string): string {
  return `${registration} is ${distanceKm.toFixed(1)} km off the planned route to ${destinationName} (limit ${ROUTE_DEVIATION_KM} km).`;
}

// ── Rule 2: manifest reconciliation ─────────────────────────────────────────

export type ManifestReconciliation = {
  loaded: string[];
  received: string[];
  /** Loaded at origin, never received at destination. */
  missing: string[];
  /** Received at destination, never loaded at origin. */
  unexpected: string[];
  balanced: boolean;
};

/**
 * Compares assets LOADed at origin with assets RECEIVEd at destination.
 * A trip may close only when the two sets are identical: no tolerance and
 * no override, so an unbalanced trip stays open.
 */
export function reconcileManifest(
  loadedAssetIds: Iterable<string>,
  receivedAssetIds: Iterable<string>,
): ManifestReconciliation {
  const loaded = [...new Set(loadedAssetIds)];
  const received = [...new Set(receivedAssetIds)];
  const loadedSet = new Set(loaded);
  const receivedSet = new Set(received);
  const missing = loaded.filter((id) => !receivedSet.has(id));
  const unexpected = received.filter((id) => !loadedSet.has(id));
  return { loaded, received, missing, unexpected, balanced: missing.length === 0 && unexpected.length === 0 };
}

/** Keeps the message short: long serial lists are truncated. */
export function manifestMismatchMessage(r: ManifestReconciliation, serialOf: (assetId: string) => string): string {
  const list = (ids: string[]) => {
    const shown = ids.slice(0, 8).map(serialOf).join(", ");
    return ids.length > 8 ? `${shown} +${ids.length - 8} more` : shown;
  };
  const parts = [`Closure blocked: ${r.loaded.length} loaded at origin, ${r.received.length} received at destination.`];
  if (r.missing.length) parts.push(`Not received: ${list(r.missing)}.`);
  if (r.unexpected.length) parts.push(`Received but never loaded: ${list(r.unexpected)}.`);
  return parts.join(" ");
}

// ── Unscheduled stops ───────────────────────────────────────────────────────

/** Pings this close together count as standing still (GPS wobbles a few metres). */
export const STOP_RADIUS_KM = 0.05;
/**
 * Trackers report every 30 s or faster, so a longer silence breaks the spell:
 * a vehicle we didn't hear from isn't known to have stood still.
 */
const MAX_PING_GAP_MS = 90_000;

type TimedFix = Fix & { recordedAt: string };

/** When the current stationary spell began: the start of the unbroken run of pings within STOP_RADIUS_KM of `current`. */
export function stationarySince(earlier: readonly TimedFix[], current: TimedFix): string {
  let since = current.recordedAt;
  for (let i = earlier.length - 1; i >= 0; i--) {
    const ping = earlier[i];
    if (Date.parse(since) - Date.parse(ping.recordedAt) > MAX_PING_GAP_MS) break;
    if (kmBetween(ping, current) > STOP_RADIUS_KM) break;
    since = ping.recordedAt;
  }
  return since;
}

const minutesText = (minutes: number) => (minutes < 1 ? `${Math.round(minutes * 60)} s` : `${Math.round(minutes * 10) / 10} min`);

export function stopMessage(registration: string, minutes: number, where: Fix, limitMinutes: number): string {
  return `${registration} has been standing still for ${minutesText(minutes)} at ${where.lat.toFixed(4)}, ${where.lng.toFixed(4)}, away from any facility (limit ${minutesText(limitMinutes)}).`;
}

// ── RFID presence ───────────────────────────────────────────────────────────

/** Badges or tags that dropped out of, or came back into, a reader's view between two reads. */
export function presenceChange(before: readonly string[], after: readonly string[]): { left: string[]; returned: string[] } {
  const was = new Set(before);
  const is = new Set(after);
  return { left: before.filter((id) => !is.has(id)), returned: after.filter((id) => !was.has(id)) };
}

// ── Crew away from their vehicle ────────────────────────────────────────────

/**
 * How far a crew member's phone may be from their vehicle while it's on the
 * road. At a facility they may move about its grounds (loading, offloading),
 * so the limit is at least FACILITY_RADIUS_KM there.
 */
export function crewAwayLimitKm(limitMetres: number, vehicleAtFacility: boolean): number {
  const km = limitMetres / 1000;
  return vehicleAtFacility ? Math.max(km, FACILITY_RADIUS_KM) : km;
}

export function crewAwayMessage(o: {
  name: string;
  duty: string;
  registration: string;
  metres: number;
  limitMetres: number;
  facilityName: string | null;
  onBoard: number;
  crewTotal: number;
}): string {
  const where = o.facilityName ? `and has left the grounds of ${o.facilityName}` : "away from any facility";
  const far = o.metres < 1000 ? `${Math.round(o.metres)} m` : `${(o.metres / 1000).toFixed(1)} km`;
  return `${o.name} (${o.duty}) is ${far} from ${o.registration} ${where} (limit ${Math.round(o.limitMetres)} m). ${o.onBoard} of ${o.crewTotal} crew with the vehicle.`;
}
