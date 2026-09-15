"use client";

import type { Feature, FeatureCollection, LineString, Point, Position } from "geojson";
import {
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
  type GeoJSONSource,
  type MapLayerMouseEvent,
} from "maplibre-gl";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LABEL } from "@/lib/format";
import { ROUTE_DEVIATION_KM, toLngLat } from "@/lib/rules";
import { find, lastPing, personStatus, roadTripFor, tripPings } from "@/lib/selectors";
import { AlertType, FacilityType, TripState, type DemoState, type Facility, type Trip } from "@/lib/types";
import { STYLE_URL } from "./maplibre";
import { PERSON_STATE_COLOR } from "./ui";

/** What the map should frame: a trip's route, a facility, or a point such as an alert or a scan. */
export type MapFocus =
  | { kind: "trip"; id: string }
  | { kind: "facility"; id: string }
  | { kind: "point"; lat: number; lng: number; label?: string };

const SOURCES = ["routes", "trails", "facilities", "incidents", "tethers", "people", "vehicles"] as const;
type SourceId = (typeof SOURCES)[number];
const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

// The 2 km corridor drawn to scale: a line 2 × ROUTE_DEVIATION_KM wide whose
// pixel width doubles with each zoom level (Web Mercator at Gauteng's latitude).
const METRES_PER_PX_AT_Z0 = 156_543.03 * Math.cos((26.2 * Math.PI) / 180);
const corridorPx = (zoom: number) => (2 * ROUTE_DEVIATION_KM * 1000 * 2 ** zoom) / METRES_PER_PX_AT_Z0;

const COLOR = {
  transit: "#2563eb",
  arrived: "#d97706",
  closed: "#059669",
  alert: "#dc2626",
  planned: "#475569",
  station: "#059669",
  warehouse: "#0f172a",
};

export const ALERT_COLOR: Record<AlertType, string> = {
  MANIFEST_MISMATCH: "#dc2626",
  ROUTE_DEVIATION: "#ea580c",
  UNSCHEDULED_STOP: "#d97706",
  CREW_LEFT_VEHICLE: "#dc2626",
  CREW_AWAY_FROM_VEHICLE: "#b91c1c",
  ASSET_NOT_DETECTED: "#be123c",
};

type Props = {
  state: DemoState;
  focus: MapFocus | null;
  onSelectTrip: (tripId: string) => void;
  onSelectPerson?: (userId: string) => void;
};

export function MapView({ state, focus, onSelectTrip, onSelectPerson }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const latest = useRef({ state, focus, onSelectTrip, onSelectPerson });
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const focusTripId = focus?.kind === "trip" ? focus.id : null;
  const focusKey = focus ? JSON.stringify(focus) : "";

  useEffect(() => {
    latest.current = { state, focus, onSelectTrip, onSelectPerson };
  });

  useEffect(() => {
    if (!container.current) return;
    const bounds = new LngLatBounds();
    for (const f of latest.current.state.facilities) bounds.extend([f.lng, f.lat]);

    const map = new MapLibreMap({
      container: container.current,
      style: STYLE_URL,
      bounds,
      fitBoundsOptions: { padding: 48 },
      attributionControl: { compact: true },
      // On touch screens one finger scrolls the page and two move the map.
      cooperativeGestures: window.matchMedia("(pointer: coarse)").matches,
    });
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");

    let loaded = false;
    map.on("load", () => {
      loaded = true;
      addLayers(map);
      setReady(true);
    });
    map.on("error", () => {
      if (!loaded) setFailed(true);
    });

    const selectTrip = (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.tripId;
      if (typeof id === "string") latest.current.onSelectTrip(id);
    };
    for (const layer of ["vehicles", "incidents", "trails", "route-active", "route-planned"]) map.on("click", layer, selectTrip);
    map.on("click", "people", (e) => {
      const id = e.features?.[0]?.properties?.userId;
      if (typeof id === "string") latest.current.onSelectPerson?.(id);
    });
    for (const layer of ["vehicles", "incidents", "trails", "route-active", "route-planned", "facilities", "people"]) {
      map.on("mouseenter", layer, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layer, () => {
        map.getCanvas().style.cursor = "";
      });
    }
    map.on("click", "facilities", (e) => {
      const facility = find(latest.current.state.facilities, e.features?.[0]?.properties?.id);
      if (facility) showFacility(map, facility);
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // Push every state change (a ping, an RFID read, an alert) into the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const data = mapData(state, focusTripId);
    for (const id of SOURCES) void (map.getSource(id) as GeoJSONSource | undefined)?.setData(data[id]);
  }, [state, focusTripId, ready]);

  // Frame the focus when it changes, not on every ping.
  useEffect(() => {
    const map = mapRef.current;
    const target = latest.current.focus;
    if (!ready || !map || !target) return;
    markerRef.current?.remove();
    markerRef.current = null;
    const s = latest.current.state;

    if (target.kind === "trip") {
      const trip = find(s.trips, target.id);
      if (!trip) return;
      const bounds = new LngLatBounds();
      for (const p of trip.plannedRoute) bounds.extend(toLngLat(p));
      const last = lastPing(s, trip.id);
      if (last) bounds.extend([last.lng, last.lat]);
      map.fitBounds(bounds, { padding: 64, maxZoom: 13, duration: 800 });
    } else if (target.kind === "facility") {
      const facility = find(s.facilities, target.id);
      if (!facility) return;
      map.flyTo({ center: [facility.lng, facility.lat], zoom: 14, duration: 800 });
      showFacility(map, facility);
    } else {
      map.flyTo({ center: [target.lng, target.lat], zoom: 14, duration: 800 });
      const marker = new Marker({ color: COLOR.alert }).setLngLat([target.lng, target.lat]);
      if (target.label) marker.setPopup(new Popup({ offset: 28, closeButton: false }).setText(target.label));
      marker.addTo(map);
      if (target.label) marker.togglePopup();
      markerRef.current = marker;
    }
  }, [focusKey, ready]);

  return (
    <div className="absolute inset-0">
      {/* MapLibre sets position: relative on its container, so size it explicitly. */}
      <div ref={container} className="h-full w-full" />
      <Legend />
      {failed && (
        <div className="absolute inset-x-4 top-4 rounded-lg bg-white/95 p-3 text-sm text-slate-700 shadow ring-1 ring-slate-200">
          The basemap couldn&apos;t load (offline?). Trips, scans and alerts still work.
        </div>
      )}
    </div>
  );
}

function showFacility(map: MapLibreMap, f: Facility) {
  const el = document.createElement("div");
  const title = document.createElement("div");
  title.style.fontWeight = "600";
  title.textContent = f.name;
  const sub = document.createElement("div");
  sub.style.color = "#64748b";
  sub.textContent = `${f.type === FacilityType.WAREHOUSE ? "Warehouse" : "Voting station"} · ${f.municipality}`;
  el.append(title, sub);
  new Popup({ closeButton: false, offset: 12 }).setLngLat([f.lng, f.lat]).setDOMContent(el).addTo(map);
}

/** GeoJSON for every source. Colours, widths and labels are decided here so the layers just read them. */
function mapData(s: DemoState, focusTripId: string | null): Record<SourceId, FeatureCollection> {
  const alerting = new Set(s.alerts.filter((a) => !a.acknowledged).map((a) => a.tripId));
  const shown = s.trips.filter((t) => t.state !== TripState.CLOSED || t.id === focusTripId);
  const color = (t: Trip) =>
    alerting.has(t.id)
      ? COLOR.alert
      : t.state === TripState.ARRIVED
        ? COLOR.arrived
        : t.state === TripState.CLOSED
          ? COLOR.closed
          : COLOR.transit;
  const props = (t: Trip) => ({ tripId: t.id, state: t.state, color: color(t), width: t.id === focusTripId ? 5 : 3.5 });
  const line = (coordinates: Position[], properties: Record<string, unknown>): Feature<LineString> => ({
    type: "Feature",
    geometry: { type: "LineString", coordinates },
    properties,
  });
  const point = (coordinates: Position, properties: Record<string, unknown>): Feature<Point> => ({
    type: "Feature",
    geometry: { type: "Point", coordinates },
    properties,
  });
  const collection = (features: Feature[]): FeatureCollection => ({ type: "FeatureCollection", features });

  const routes = shown.map((t) => line(t.plannedRoute.map(toLngLat), props(t)));
  const trails = shown.flatMap((t) => {
    const pings = tripPings(s, t.id);
    return pings.length < 2 ? [] : [line(pings.map((p) => [p.lng, p.lat]), props(t))];
  });
  const vehicles = shown.flatMap((t) => {
    if (t.state !== TripState.IN_TRANSIT && t.state !== TripState.ARRIVED) return [];
    const ping = lastPing(s, t.id);
    if (!ping) return [];
    const vehicle = find(s.vehicles, t.vehicleId);
    const aboard = vehicle?.onboard ? `\n${vehicle.onboard.crewIds.length} crew · ${vehicle.onboard.assetIds.length} assets` : "";
    return [point([ping.lng, ping.lat], { ...props(t), label: `${vehicle?.registration ?? ""}${aboard}` })];
  });
  // Where each open alert happened (manifest mismatches have no location).
  const incidents = s.alerts
    .filter((a) => !a.acknowledged && a.lat !== null && a.lng !== null)
    .map((a) => point([a.lng as number, a.lat as number], { tripId: a.tripId, color: ALERT_COLOR[a.type], label: LABEL.alertType[a.type] }));
  const facilities = s.facilities.map((f) =>
    point([f.lng, f.lat], {
      id: f.id,
      name: f.name,
      color: f.type === FacilityType.WAREHOUSE ? COLOR.warehouse : COLOR.station,
      radius: f.type === FacilityType.WAREHOUSE ? 8 : 6,
    }),
  );

  // People: everyone's latest phone location, except crew riding with a vehicle
  // on the map (the vehicle stands for them). Someone away from their vehicle
  // gets a dashed line back to it.
  const people: Feature[] = [];
  const tethers: Feature[] = [];
  for (const u of s.users) {
    if (!u.active) continue;
    const st = personStatus(s, u);
    if (!st.position || st.state === "ON_BOARD") continue;
    const away = st.state === "AWAY";
    const at: Position = [st.position.lng, st.position.lat];
    people.push(point(at, { userId: u.id, color: PERSON_STATE_COLOR[st.state], label: u.name, away, radius: away ? 7 : 5 }));
    const trip = away && st.vehicle ? roadTripFor(s, st.vehicle.id) : undefined;
    const vehicleAt = trip ? lastPing(s, trip.id) : undefined;
    if (vehicleAt) tethers.push(line([at, [vehicleAt.lng, vehicleAt.lat]], { color: PERSON_STATE_COLOR.AWAY }));
  }

  return {
    routes: collection(routes),
    trails: collection(trails),
    facilities: collection(facilities),
    incidents: collection(incidents),
    tethers: collection(tethers),
    people: collection(people),
    vehicles: collection(vehicles),
  };
}

function addLayers(map: MapLibreMap) {
  for (const id of SOURCES) map.addSource(id, { type: "geojson", data: EMPTY });

  map.addLayer({
    id: "route-corridor",
    type: "line",
    source: "routes",
    filter: ["==", ["get", "state"], TripState.IN_TRANSIT],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ["get", "color"],
      "line-opacity": 0.1,
      "line-width": ["interpolate", ["exponential", 2], ["zoom"], 5, corridorPx(5), 16, corridorPx(16)],
    },
  });
  map.addLayer({
    id: "route-planned",
    type: "line",
    source: "routes",
    filter: ["==", ["get", "state"], TripState.PLANNED],
    paint: { "line-color": COLOR.planned, "line-width": ["get", "width"], "line-dasharray": [2, 1.5], "line-opacity": 0.85 },
  });
  map.addLayer({
    id: "route-active",
    type: "line",
    source: "routes",
    filter: ["!=", ["get", "state"], TripState.PLANNED],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#64748b", "line-width": ["get", "width"], "line-opacity": 0.45 },
  });
  map.addLayer({
    id: "trails",
    type: "line",
    source: "trails",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": ["get", "color"], "line-width": 3.5 },
  });
  map.addLayer({
    id: "facilities",
    type: "circle",
    source: "facilities",
    paint: {
      "circle-radius": ["get", "radius"],
      "circle-color": ["get", "color"],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });
  map.addLayer({
    id: "facility-labels",
    type: "symbol",
    source: "facilities",
    minzoom: 9.5,
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Regular"],
      "text-size": 11,
      "text-offset": [0, 1],
      "text-anchor": "top",
      "text-max-width": 12,
      "text-optional": true,
    },
    paint: { "text-color": "#334155", "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
  });
  map.addLayer({
    id: "incidents",
    type: "circle",
    source: "incidents",
    paint: { "circle-radius": 7, "circle-color": "#ffffff", "circle-stroke-color": ["get", "color"], "circle-stroke-width": 3 },
  });
  map.addLayer({
    id: "incident-labels",
    type: "symbol",
    source: "incidents",
    layout: {
      "text-field": ["get", "label"],
      "text-font": ["Noto Sans Bold"],
      "text-size": 10,
      "text-offset": [0, -1.3],
      "text-anchor": "bottom",
      "text-optional": true,
    },
    paint: { "text-color": ["get", "color"], "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
  });
  map.addLayer({
    id: "tethers",
    type: "line",
    source: "tethers",
    paint: { "line-color": ["get", "color"], "line-width": 2, "line-dasharray": [1.5, 1.5] },
  });
  map.addLayer({
    id: "people",
    type: "circle",
    source: "people",
    paint: {
      "circle-radius": ["get", "radius"],
      "circle-color": ["get", "color"],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });
  map.addLayer({
    id: "people-labels",
    type: "symbol",
    source: "people",
    filter: ["!=", ["get", "away"], true],
    minzoom: 12.5,
    layout: {
      "text-field": ["get", "label"],
      "text-font": ["Noto Sans Regular"],
      "text-size": 10,
      "text-offset": [0, 0.9],
      "text-anchor": "top",
      "text-optional": true,
    },
    paint: { "text-color": "#334155", "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
  });
  map.addLayer({
    id: "people-labels-away",
    type: "symbol",
    source: "people",
    filter: ["==", ["get", "away"], true],
    layout: {
      "text-field": ["get", "label"],
      "text-font": ["Noto Sans Bold"],
      "text-size": 11,
      "text-offset": [0, 1],
      "text-anchor": "top",
      "text-allow-overlap": true,
    },
    paint: { "text-color": "#b91c1c", "text-halo-color": "#ffffff", "text-halo-width": 2 },
  });
  map.addLayer({
    id: "vehicle-halo",
    type: "circle",
    source: "vehicles",
    paint: { "circle-radius": 16, "circle-color": ["get", "color"], "circle-opacity": 0.18 },
  });
  map.addLayer({
    id: "vehicles",
    type: "circle",
    source: "vehicles",
    paint: { "circle-radius": 8, "circle-color": ["get", "color"], "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 },
  });
  map.addLayer({
    id: "vehicle-labels",
    type: "symbol",
    source: "vehicles",
    layout: {
      "text-field": ["get", "label"],
      "text-font": ["Noto Sans Bold"],
      "text-size": 11,
      "text-offset": [0, 1.3],
      "text-anchor": "top",
      "text-allow-overlap": true,
    },
    paint: { "text-color": "#0f172a", "text-halo-color": "#ffffff", "text-halo-width": 2 },
  });
}

function Legend() {
  const row = (swatch: ReactNode, label: string) => (
    <div className="flex items-center gap-2">
      <span className="flex w-5 justify-center">{swatch}</span>
      {label}
    </div>
  );
  return (
    <div className="pointer-events-none absolute bottom-7 left-2 hidden space-y-1 rounded-lg bg-white/90 px-3 py-2 text-[11px] text-slate-600 shadow-sm ring-1 ring-slate-200 backdrop-blur sm:block">
      {row(<span className="size-2.5 rounded-full bg-slate-900" />, "Warehouse")}
      {row(<span className="size-2.5 rounded-full bg-emerald-600" />, "Voting station")}
      {row(<span className="h-1 w-5 rounded bg-blue-600" />, "Driven so far")}
      {row(<span className="w-5 border-t-2 border-dashed border-slate-600" />, "Planned route")}
      {row(<span className="h-2.5 w-5 rounded bg-blue-600/15" />, `${ROUTE_DEVIATION_KM} km corridor`)}
      {row(<span className="size-2.5 rounded-full bg-red-600" />, "Vehicle with an open alert")}
      {row(<span className="size-2.5 rounded-full border-2 border-red-600 bg-white" />, "Where an alert happened")}
      {row(<span className="size-2 rounded-full bg-emerald-600 ring-2 ring-white" />, "Person (phone location)")}
      {row(<span className="w-5 border-t-2 border-dashed border-red-600" />, "Person away from their vehicle")}
    </div>
  );
}
