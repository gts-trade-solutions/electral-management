import { kmBetween } from "./rules";
import type { Facility, LatLng } from "./types";

export type PlannedRoute = { route: LatLng[]; source: "ROAD" | "STRAIGHT_LINE"; km: number };

const OSRM = "https://router.project-osrm.org/route/v1/driving";
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Road route from the public OSRM demo server: fine for a demo, not for
 * production traffic. Falls back to a straight line if it can't be reached.
 */
export async function planRoute(from: Facility, to: Facility): Promise<PlannedRoute> {
  const straight: PlannedRoute = {
    route: [[from.lat, from.lng], [to.lat, to.lng]],
    source: "STRAIGHT_LINE",
    km: kmBetween(from, to),
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch(`${OSRM}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=simplified&geometries=geojson`, {
      signal: controller.signal,
    });
    if (!res.ok) return straight;
    const body = (await res.json()) as { routes?: { distance: number; geometry: { coordinates: [number, number][] } }[] };
    const best = body.routes?.[0];
    if (!best || best.geometry.coordinates.length < 2) return straight;
    const road = best.geometry.coordinates.map(([lng, lat]) => [round6(lat), round6(lng)] as LatLng);
    // OSRM snaps to the nearest road; start and end exactly at the facilities.
    return { route: [[from.lat, from.lng], ...road, [to.lat, to.lng]], source: "ROAD", km: best.distance / 1000 };
  } catch {
    return straight;
  } finally {
    clearTimeout(timer);
  }
}
