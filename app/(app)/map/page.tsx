"use client";

import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AlertList } from "@/components/AlertList";
import type { MapFocus } from "@/components/MapView";
import { SimulatorPanel } from "@/components/SimulatorPanel";
import { Badge, cx, Empty, TRIP_STATE_TONE } from "@/components/ui";
import { formatKm, LABEL, timeAgo } from "@/lib/format";
import { useCan, useData, useNow } from "@/lib/hooks";
import { distanceFromRouteKm } from "@/lib/rules";
import { find, lastPing, tripParts } from "@/lib/selectors";
import { TripState, type Alert, type Trip } from "@/lib/types";

// MapLibre needs the browser (WebGL, window), so it never renders on the server.
const MapView = dynamic(() => import("@/components/MapView").then((m) => m.MapView), {
  ssr: false,
  loading: () => <div className="absolute inset-0 grid place-items-center bg-slate-200 text-sm text-slate-500">Loading map…</div>,
});

const ORDER: Record<TripState, number> = { IN_TRANSIT: 0, ARRIVED: 1, PLANNED: 2, CLOSED: 3 };

/** ?at=lat,lng (a scan or an alert), ?facility=id or ?trip=id, in that order of preference. */
function focusFromParams(params: { get(name: string): string | null }): MapFocus | null {
  const at = params.get("at")?.split(",").map(Number);
  if (at && at.length === 2 && at.every(Number.isFinite)) {
    return { kind: "point", lat: at[0], lng: at[1], label: params.get("label") ?? undefined };
  }
  const facility = params.get("facility");
  if (facility) return { kind: "facility", id: facility };
  const trip = params.get("trip");
  return trip ? { kind: "trip", id: trip } : null;
}

export default function MapPage() {
  return (
    <Suspense>
      <MapScreen />
    </Suspense>
  );
}

function MapScreen() {
  const s = useData();
  const allowed = useCan();
  const params = useSearchParams();
  const router = useRouter();
  const paramKey = params.toString();
  const [focus, setFocus] = useState<MapFocus | null>(() => focusFromParams(params));
  // A new ?trip= / ?facility= / ?at= link while already on the map re-frames it.
  const [seenKey, setSeenKey] = useState(paramKey);
  if (seenKey !== paramKey) {
    setSeenKey(paramKey);
    setFocus(focusFromParams(params));
  }

  const focusTripId = focus?.kind === "trip" ? focus.id : null;
  const focusTrip = (id: string) => setFocus({ kind: "trip", id });
  const showAlert = (a: Alert) =>
    setFocus(a.lat !== null && a.lng !== null ? { kind: "point", lat: a.lat, lng: a.lng, label: LABEL.alertType[a.type] } : { kind: "trip", id: a.tripId });

  const openAlerts = s.alerts.filter((a) => !a.acknowledged).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const openTrips = s.trips.filter((t) => t.state !== TripState.CLOSED).sort((a, b) => ORDER[a.state] - ORDER[b.state]);

  return (
    <div className="lg:grid lg:h-[calc(100dvh-3.5rem)] lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="relative h-[55dvh] lg:h-full">
        <MapView state={s} focus={focus} onSelectTrip={focusTrip} onSelectPerson={(id) => router.push(`/people?id=${id}`)} />
      </div>
      <aside className="space-y-5 bg-slate-50 p-4 lg:overflow-y-auto lg:border-l lg:border-slate-200">
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
            Open alerts
            {openAlerts.length > 0 && <Badge tone="red">{openAlerts.length}</Badge>}
          </h2>
          <AlertList alerts={openAlerts} onShowOnMap={showAlert} emptyText="No open alerts. All trips are on plan." />
        </section>
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Trips on the board</h2>
          <TripList trips={openTrips} focus={focusTripId} onFocus={focusTrip} />
        </section>
        {allowed("runSimulator") && <SimulatorPanel preferredTripId={focusTripId} />}
      </aside>
    </div>
  );
}

function TripList({ trips, focus, onFocus }: { trips: Trip[]; focus: string | null; onFocus: (id: string) => void }) {
  const s = useData();
  const now = useNow(15_000);
  if (!trips.length) return <Empty title="No open trips" />;
  return (
    <ul className="space-y-2">
      {trips.map((t) => {
        const { vehicle, destination } = tripParts(s, t);
        const ping = lastPing(s, t.id);
        const offKm = ping && t.state === TripState.IN_TRANSIT ? distanceFromRouteKm(t.plannedRoute, ping) : null;
        const alerting = s.alerts.some((a) => a.tripId === t.id && !a.acknowledged);
        const aboard = find(s.vehicles, t.vehicleId)?.onboard;
        return (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => onFocus(t.id)}
              className={cx(
                "w-full rounded-lg bg-white p-3 text-left ring-1 hover:ring-slate-300",
                focus === t.id ? "ring-2 ring-blue-500" : "ring-slate-200",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-slate-900">{vehicle.registration}</span>
                <Badge tone={alerting ? "red" : TRIP_STATE_TONE[t.state]}>{alerting ? "Alert" : LABEL.tripState[t.state]}</Badge>
              </div>
              <p className="mt-0.5 truncate text-xs text-slate-500">→ {destination.name}</p>
              {t.state !== TripState.PLANNED && (
                <p className="mt-1 text-xs text-slate-500">
                  Last ping {timeAgo(ping?.recordedAt, now)}
                  {offKm !== null && ` · ${formatKm(offKm)} from route`}
                  {aboard && ` · ${aboard.crewIds.length} crew, ${aboard.assetIds.length} assets on board`}
                </p>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
