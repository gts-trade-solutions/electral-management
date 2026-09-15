"use client";

import { Plus, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Badge, Button, Card, cx, Empty } from "@/components/ui";
import { VEHICLE_STATUS_TONE, VehicleDetail } from "@/components/vehicles/VehicleDetail";
import { VehicleForm } from "@/components/vehicles/VehicleForm";
import { LABEL } from "@/lib/format";
import { useCan, useData } from "@/lib/hooks";
import { onboard, openTripFor, tripParts } from "@/lib/selectors";
import { Role, VehicleStatus } from "@/lib/types";

const ORDER: Record<VehicleStatus, number> = { ON_TRIP: 0, AVAILABLE: 1, OUT_OF_SERVICE: 2 };

export default function VehiclesPage() {
  return (
    <Suspense>
      <VehiclesScreen />
    </Suspense>
  );
}

function VehiclesScreen() {
  const s = useData();
  const allowed = useCan();
  const router = useRouter();
  const params = useSearchParams();
  const selectedId = params.get("id");
  const [adding, setAdding] = useState(false);

  const select = (id: string | null) => {
    setAdding(false);
    router.replace(id ? `/vehicles?id=${id}` : "/vehicles", { scroll: false });
  };
  const vehicles = [...s.vehicles].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.registration.localeCompare(b.registration));
  const active = s.users.filter((u) => u.active);
  const assigned = active.filter((u) => u.vehicleId).length;
  // Field people waiting for a vehicle (office staff aren't listed here).
  const pool = active.filter((u) => !u.vehicleId && (u.role === Role.CREW || u.role === Role.OFFICER));
  const detailOpen = adding || !!selectedId;

  return (
    <div className="mx-auto grid max-w-7xl gap-4 p-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <aside className={cx("space-y-3", detailOpen && "hidden lg:block")}>
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Vehicles &amp; RFID</h1>
            <p className="text-xs text-slate-500">
              {s.vehicles.length} vehicles · {assigned} people assigned
            </p>
          </div>
          {allowed("manageVehicles") && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="size-4" aria-hidden /> Add vehicle
            </Button>
          )}
        </div>
        <ul className="space-y-2">
          {vehicles.map((v) => {
            const trip = openTripFor(s, v.id);
            const reader = onboard(s, v);
            const crewOn = reader.crew.filter((c) => c.detected).length;
            const assetsOn = reader.assets.filter((a) => a.detected).length;
            const shortfall = reader.live && (crewOn < reader.crew.length || assetsOn < reader.assets.length);
            const alerting = !!trip && s.alerts.some((a) => a.tripId === trip.id && !a.acknowledged);
            return (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => select(v.id)}
                  className={cx(
                    "w-full rounded-xl bg-white p-3 text-left shadow-sm ring-1 hover:ring-slate-300",
                    selectedId === v.id && !adding ? "ring-2 ring-blue-500" : "ring-slate-200",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-900">{v.registration}</span>
                    <span className="flex items-center gap-1.5">
                      {alerting && <TriangleAlert className="size-4 text-red-600" aria-label="Open alert" />}
                      <Badge tone={VEHICLE_STATUS_TONE[v.status]}>{LABEL.vehicleStatus[v.status]}</Badge>
                    </span>
                  </div>
                  <p className="mt-1 truncate text-sm text-slate-600">
                    {trip ? `${LABEL.tripState[trip.state]} → ${tripParts(s, trip).destination.name}` : "No open trip"}
                  </p>
                  <p className={cx("mt-1 text-xs", shortfall ? "font-medium text-red-600" : "text-slate-500")}>
                    {reader.live
                      ? `On board: ${crewOn}/${reader.crew.length} people · ${assetsOn}/${reader.assets.length} assets`
                      : `${reader.crew.length} ${reader.crew.length === 1 ? "member" : "members"} · ${v.seats} seats`}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-700">
                    {reader.crew.length
                      ? reader.crew.map(({ member }) => `${member.name}${member.duty ? ` (${LABEL.crewRole[member.duty].toLowerCase()})` : ""}`).join(", ")
                      : "Nobody assigned"}
                  </p>
                  <p className="text-xs text-slate-400">
                    Tag …{v.rfidTag.slice(-8)} · {v.readerId}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
        {pool.length > 0 && (
          <Card title={`Not on a vehicle · ${pool.length}`} subtitle="Assign them from a vehicle's page or their own.">
            <ul className="space-y-1 text-sm text-slate-700">
              {pool.map((u) => (
                <li key={u.id}>
                  <Link href={`/people?id=${u.id}`} className="text-blue-700 hover:underline">
                    {u.name}
                  </Link>{" "}
                  <span className="text-xs text-slate-500">· {LABEL.role[u.role]}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </aside>

      <section className={cx("min-w-0", !detailOpen && "hidden lg:block")}>
        {adding ? (
          <VehicleForm onDone={(id) => select(id)} onCancel={() => setAdding(false)} />
        ) : selectedId ? (
          <VehicleDetail vehicleId={selectedId} onBack={() => select(null)} />
        ) : (
          <Empty title="Select a vehicle">See where it is, who and what is on board, and its RFID activity.</Empty>
        )}
      </section>
    </div>
  );
}
