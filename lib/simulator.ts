/**
 * In-browser GPS, RFID and phone simulator. Replays pings along a trip's
 * route so the map moves during a demo, feeding recordPing() exactly as a
 * tracker with an in-cab RFID reader would, and recordUserPing() for each
 * crew member's phone. It can also stage incidents: stop the vehicle, have a
 * crew member step out and walk off, or lose an asset's tag. Module-level
 * rather than a component, so it keeps running while you move between screens.
 */
import { along, bearing, destination, length, lineSliceAlong, lineString, nearestPointOnLine, point } from "@turf/turf";
import type { Feature, LineString, Position } from "geojson";
import { useSyncExternalStore } from "react";
import { DomainError, recordPing, recordUserPing, type ReaderSnapshot } from "./domain";
import { ROUTE_DEVIATION_KM, routeLine } from "./rules";
import { crewOf, find, lastPing, userPosition } from "./selectors";
import { loadDemo, run } from "./store";
import { AssetState, PingSource, TripState, type DemoState, type Fix, type Trip } from "./types";

export type SimMode = "ON_ROUTE" | "OFF_ROUTE";

export type SimStatus = {
  tripId: string;
  mode: SimMode;
  speed: number;
  doneKm: number;
  totalKm: number;
  distanceFromRouteKm: number;
  /** The vehicle is holding its position (an unscheduled stop). */
  paused: boolean;
  stoppedMinutes: number;
  /** Crew whose badges the reader no longer sees: they've stepped out. */
  awayCrewIds: string[];
  /** Assets whose tags the reader no longer sees. */
  lostAssetIds: string[];
};

const TICK_MS = 1000;
const CRUISE_KMH = 60;
const KM = { units: "kilometers" } as const;
/** How far the OFF_ROUTE detour swings away from the route: well past the 2 km limit. */
export const DETOUR_KM = ROUTE_DEVIATION_KM + 1.5;
/** How far someone who stepped out walks each tick: a brisk pace, sped up like the vehicle. */
const WALK_KM_PER_TICK = 0.015;
/** Someone whose own phone reported this recently is tracked for real, so the simulator leaves them alone. */
const REAL_PHONE_FRESH_MS = 120_000;

let snapshot: { status: SimStatus | null; message: string | null } = { status: null, message: null };
let path: Feature<LineString> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
/** Crew who stepped out: where their phone is now, and which way they're walking. */
const walkers = new Map<string, { at: Fix; bearing: number }>();
const listeners = new Set<() => void>();

function walk(from: Fix, bearingDeg: number, km: number): Fix {
  const [lng, lat] = destination(point([from.lng, from.lat]), km, bearingDeg, KM).geometry.coordinates;
  return { lat, lng };
}

function publish(next: typeof snapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function patchStatus(patch: Partial<SimStatus>) {
  if (snapshot.status) publish({ ...snapshot, status: { ...snapshot.status, ...patch } });
}

/**
 * The line the simulated vehicle drives: the rest of the planned route from
 * where it is now, or the same with a detour that leaves the 2 km corridor
 * for a few kilometres and then rejoins (one edge-triggered alert).
 */
export function simulationPath(trip: Trip, from: Fix | null, mode: SimMode): Feature<LineString> {
  const planned = routeLine(trip.plannedRoute);
  const totalKm = length(planned, KM);
  const startKm = from ? nearestPointOnLine(planned, point([from.lng, from.lat]), KM).properties.totalDistance : 0;
  const remaining = totalKm - startKm;
  if (remaining < 0.05) throw new DomainError("The vehicle is already at its destination");
  if (mode === "ON_ROUTE") return lineSliceAlong(planned, startKm, totalKm, KM);

  if (remaining < 1) throw new DomainError("Too close to the destination to simulate a detour");
  const leaveKm = startKm + Math.min(1, remaining * 0.15);
  const rejoinKm = Math.min(leaveKm + 5, startKm + remaining * 0.85);
  const leave = along(planned, leaveKm, KM);
  const rejoin = along(planned, rejoinKm, KM);
  const side = bearing(leave, rejoin) + 90;
  const coords: Position[] = [
    ...lineSliceAlong(planned, startKm, leaveKm, KM).geometry.coordinates,
    destination(leave, DETOUR_KM, side, KM).geometry.coordinates,
    destination(rejoin, DETOUR_KM, side, KM).geometry.coordinates,
    ...lineSliceAlong(planned, rejoinKm, totalKm, KM).geometry.coordinates,
  ];
  return lineString(coords.filter((c, i) => i === 0 || c[0] !== coords[i - 1][0] || c[1] !== coords[i - 1][1]));
}

/** What the in-cab reader would see: the assigned crew and loaded assets, minus anyone or anything the demo has taken away. */
export function readerSnapshot(s: DemoState, tripId: string, awayCrewIds: readonly string[], lostAssetIds: readonly string[]): ReaderSnapshot | undefined {
  const trip = find(s.trips, tripId);
  if (!trip) return undefined;
  return {
    crewIds: crewOf(s, trip.vehicleId).map((c) => c.id).filter((id) => !awayCrewIds.includes(id)),
    assetIds: s.assets
      .filter((a) => a.currentTripId === tripId && a.state === AssetState.IN_TRANSIT && !lostAssetIds.includes(a.id))
      .map((a) => a.id),
  };
}

export function startSimulation(state: DemoState, tripId: string, mode: SimMode, speed: number): void {
  stopSimulation(null);
  const trip = find(state.trips, tripId);
  if (!trip || trip.state !== TripState.IN_TRANSIT) throw new DomainError("Only a trip that is in transit can be simulated");
  path = simulationPath(trip, lastPing(state, tripId) ?? null, mode);
  publish({
    status: {
      tripId,
      mode,
      speed,
      doneKm: 0,
      totalKm: length(path, KM),
      distanceFromRouteKm: 0,
      paused: false,
      stoppedMinutes: 0,
      awayCrewIds: [],
      lostAssetIds: [],
    },
    message: null,
  });
  tick();
  timer = setInterval(tick, TICK_MS);
}

export function stopSimulation(message: string | null = "Simulator stopped."): void {
  if (timer) clearInterval(timer);
  timer = null;
  path = null;
  walkers.clear();
  publish({ status: null, message: snapshot.status ? message : snapshot.message });
}

/** Hold the vehicle where it is (it keeps pinging from the same spot), or drive on. */
export function setPaused(paused: boolean): void {
  patchStatus({ paused });
}

/**
 * A crew member steps out of the vehicle and walks off (their badge drops out
 * of the reader's view and their phone moves away), or comes back and climbs in.
 */
export function setCrewAway(crewId: string, away: boolean): void {
  const status = snapshot.status;
  if (!status) return;
  const others = status.awayCrewIds.filter((id) => id !== crewId);
  if (away) {
    const from = lastPing(loadDemo(), status.tripId);
    if (from) walkers.set(crewId, { at: { lat: from.lat, lng: from.lng }, bearing: Math.random() * 360 });
  } else {
    walkers.delete(crewId);
  }
  patchStatus({ awayCrewIds: away ? [...others, crewId] : others });
}

/** Where each crew member's phone is this tick: with the vehicle, or wherever they walked to. */
function simulatePhones(s: DemoState, tripId: string, vehicleAt: Fix, now: Date): DemoState {
  const trip = find(s.trips, tripId);
  if (!trip) return s;
  let state = s;
  for (const member of crewOf(s, trip.vehicleId)) {
    const last = userPosition(state, member.id);
    if (last?.source === PingSource.PHONE && now.getTime() - Date.parse(last.recordedAt) < REAL_PHONE_FRESH_MS) continue;
    const walker = walkers.get(member.id);
    if (walker) walker.at = walk(walker.at, walker.bearing, WALK_KM_PER_TICK);
    const where = walker?.at ?? { lat: vehicleAt.lat + (Math.random() - 0.5) * 0.00007, lng: vehicleAt.lng + (Math.random() - 0.5) * 0.00007 };
    state = recordUserPing(state, member.id, { ...where, accuracyM: 8 }, now, PingSource.SIMULATED).state;
  }
  return state;
}

/** An asset's tag stops being read (removed, shielded or damaged), or is read again. */
export function setTagLost(assetId: string, lost: boolean): void {
  const status = snapshot.status;
  if (!status) return;
  const others = status.lostAssetIds.filter((id) => id !== assetId);
  patchStatus({ lostAssetIds: lost ? [...others, assetId] : others });
}

function tick() {
  const status = snapshot.status;
  if (!status || !path) return;
  const atKm = Math.min(status.doneKm, status.totalKm);
  const [lng, lat] = along(path, atKm, KM).geometry.coordinates;
  // A few metres of GPS wobble; less when parked.
  const wobble = status.paused ? 0.00003 : 0.00008;
  const fix = { lat: lat + (Math.random() - 0.5) * wobble, lng: lng + (Math.random() - 0.5) * wobble };
  try {
    const now = new Date();
    const result = run((s) => {
      const ping = recordPing(s, status.tripId, fix, now, readerSnapshot(s, status.tripId, status.awayCrewIds, status.lostAssetIds));
      return { ...ping, state: simulatePhones(ping.state, status.tripId, fix, now) };
    });
    if (result.arrived) return stopSimulation("Arrived: the trip is now ARRIVED. Receive the assets, then close it.");
    if (atKm >= status.totalKm) return stopSimulation("Reached the end of the simulated path.");
    const stepKm = (CRUISE_KMH * status.speed * TICK_MS) / 3_600_000;
    patchStatus({
      doneKm: status.paused ? atKm : atKm + stepKm * (0.85 + Math.random() * 0.3),
      distanceFromRouteKm: result.check.distanceKm,
      stoppedMinutes: result.stoppedMinutes,
    });
  } catch (err) {
    stopSimulation(err instanceof Error ? err.message : "Simulator stopped.");
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSimulation() {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}
