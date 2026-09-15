"use client";

import { Plus, TriangleAlert } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { NewTripForm } from "@/components/trips/NewTripForm";
import { TripDetail } from "@/components/trips/TripDetail";
import { Badge, Button, cx, Empty, TRIP_STATE_TONE } from "@/components/ui";
import { LABEL, sastDateTime } from "@/lib/format";
import { useCan, useData } from "@/lib/hooks";
import { tripManifest, tripParts } from "@/lib/selectors";
import { TripState } from "@/lib/types";

const ORDER: Record<TripState, number> = { IN_TRANSIT: 0, ARRIVED: 1, PLANNED: 2, CLOSED: 3 };

export default function TripsPage() {
  return (
    <Suspense>
      <TripsScreen />
    </Suspense>
  );
}

function TripsScreen() {
  const s = useData();
  const allowed = useCan();
  const router = useRouter();
  const params = useSearchParams();
  const selectedId = params.get("id");
  const [creating, setCreating] = useState(false);

  const select = (id: string | null) => {
    setCreating(false);
    router.replace(id ? `/trips?id=${id}` : "/trips", { scroll: false });
  };
  const trips = [...s.trips].sort((a, b) => ORDER[a.state] - ORDER[b.state] || b.createdAt.localeCompare(a.createdAt));
  const detailOpen = creating || !!selectedId;

  return (
    <div className="mx-auto grid max-w-7xl gap-4 p-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <aside className={cx("space-y-3", detailOpen && "hidden lg:block")}>
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-slate-900">Trips</h1>
          {allowed("createTrip") && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden /> New trip
            </Button>
          )}
        </div>
        <ul className="space-y-2">
          {trips.map((t) => {
            const { vehicle, origin, destination } = tripParts(s, t);
            const rows = tripManifest(s, t.id);
            const alerting = s.alerts.some((a) => a.tripId === t.id && !a.acknowledged);
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => select(t.id)}
                  className={cx(
                    "w-full rounded-xl bg-white p-3 text-left shadow-sm ring-1 hover:ring-slate-300",
                    selectedId === t.id && !creating ? "ring-2 ring-blue-500" : "ring-slate-200",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-900">{vehicle.registration}</span>
                    <span className="flex items-center gap-1.5">
                      {alerting && <TriangleAlert className="size-4 text-red-600" aria-label="Open alert" />}
                      <Badge tone={TRIP_STATE_TONE[t.state]}>{LABEL.tripState[t.state]}</Badge>
                    </span>
                  </div>
                  <p className="mt-1 truncate text-sm text-slate-600">
                    {origin.name} → {destination.name}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {rows.length} on manifest · {rows.filter((r) => r.load).length} loaded · {rows.filter((r) => r.receive).length} received
                  </p>
                  <p className="text-xs text-slate-400">
                    {t.state === TripState.PLANNED ? `Planned ${sastDateTime(t.createdAt)}` : `Departed ${sastDateTime(t.departedAt)}`}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <section className={cx("min-w-0", !detailOpen && "hidden lg:block")}>
        {creating ? (
          <NewTripForm onCreated={(id) => select(id)} onCancel={() => setCreating(false)} />
        ) : selectedId ? (
          <TripDetail tripId={selectedId} onBack={() => select(null)} />
        ) : (
          <Empty title="Select a trip">Or create one to start a new load.</Empty>
        )}
      </section>
    </div>
  );
}
