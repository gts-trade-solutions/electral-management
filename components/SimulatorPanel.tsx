"use client";

import { CirclePause, Footprints, Play, Satellite, Square, Tag } from "lucide-react";
import { useState } from "react";
import { DomainError } from "@/lib/domain";
import { formatDuration, formatKm, LABEL } from "@/lib/format";
import { useData } from "@/lib/hooks";
import { ROUTE_DEVIATION_KM } from "@/lib/rules";
import { crewOf, find, personStatus, tripParts } from "@/lib/selectors";
import {
  DETOUR_KM,
  setCrewAway,
  setPaused,
  setTagLost,
  startSimulation,
  stopSimulation,
  useSimulation,
  type SimMode,
  type SimStatus,
} from "@/lib/simulator";
import { toast } from "@/lib/toast";
import { AssetState, TripState, type Trip } from "@/lib/types";
import { Button, Card, cx, Field, inputClass } from "./ui";

const SPEEDS = [10, 30, 60, 120];
const MODES: { mode: SimMode; title: string; detail: string }[] = [
  { mode: "ON_ROUTE", title: "On route", detail: "Follows the planned route" },
  { mode: "OFF_ROUTE", title: "Off route", detail: `Detours ${DETOUR_KM} km off, then rejoins` },
];

export function SimulatorPanel({ preferredTripId }: { preferredTripId: string | null }) {
  const s = useData();
  const { status, message } = useSimulation();
  const [tripId, setTripId] = useState("");
  const [mode, setMode] = useState<SimMode>("ON_ROUTE");
  const [speed, setSpeed] = useState(30);

  const candidates = s.trips.filter((t) => t.state === TripState.IN_TRANSIT);
  const selected = find(candidates, tripId) ?? find(candidates, preferredTripId) ?? candidates[0];
  const runningTrip = status ? find(s.trips, status.tripId) : undefined;

  const start = () => {
    if (!selected) return;
    try {
      startSimulation(s, selected.id, mode, speed);
      toast.info(mode === "OFF_ROUTE" ? "Driving a detour: watch for a route-deviation alert." : "Driving the planned route.");
    } catch (err) {
      toast.error(err instanceof DomainError ? err.message : "Couldn't start the simulator.");
    }
  };

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Satellite className="size-4" aria-hidden /> GPS and RFID simulator
        </span>
      }
      subtitle="One ping a second along a trip's route, with the in-cab RFID reader's count of crew and assets and each crew member's phone location, exactly like the real devices would send."
    >
      {status && runningTrip ? (
        <Running status={status} trip={runningTrip} />
      ) : !selected ? (
        <p className="text-sm text-slate-500">No trip is in transit. Dispatch one from Trips, then start it here.</p>
      ) : (
        <div className="space-y-3">
          <Field label="Trip">
            <select className={inputClass} value={selected.id} onChange={(e) => setTripId(e.target.value)}>
              {candidates.map((t) => {
                const p = tripParts(s, t);
                return (
                  <option key={t.id} value={t.id}>
                    {p.vehicle.registration} → {p.destination.name}
                  </option>
                );
              })}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Run">
            {MODES.map((m) => (
              <button
                key={m.mode}
                type="button"
                role="radio"
                aria-checked={mode === m.mode}
                onClick={() => setMode(m.mode)}
                className={cx(
                  "rounded-lg px-3 py-2 text-left ring-1 ring-inset",
                  mode === m.mode ? "bg-slate-900 text-white ring-slate-900" : "ring-slate-300 hover:bg-slate-50",
                )}
              >
                <span className="block text-sm font-medium">{m.title}</span>
                <span className={cx("block text-xs", mode === m.mode ? "text-slate-300" : "text-slate-500")}>{m.detail}</span>
              </button>
            ))}
          </div>
          <Field label="Speed">
            <select className={inputClass} value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
              {SPEEDS.map((x) => (
                <option key={x} value={x}>
                  {x}× real time
                </option>
              ))}
            </select>
          </Field>
          <Button className="w-full" onClick={start}>
            <Play className="size-4" aria-hidden /> Start simulator
          </Button>
          <p className="text-xs text-slate-500">
            Once it&apos;s running you can stop the vehicle, have a crew member step out and walk off, or make an asset&apos;s tag go missing.
          </p>
        </div>
      )}
      {message && !status && <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">{message}</p>}
    </Card>
  );
}

/** Progress plus the incidents you can stage while the simulator runs. */
function Running({ status, trip }: { status: SimStatus; trip: Trip }) {
  const s = useData();
  const { vehicle, destination } = tripParts(s, trip);
  const crew = crewOf(s, vehicle.id);
  const loaded = s.assets.filter((a) => a.currentTripId === trip.id && a.state === AssetState.IN_TRANSIT);
  const readable = loaded.filter((a) => !status.lostAssetIds.includes(a.id));
  const [tagAssetId, setTagAssetId] = useState("");
  const tagAsset = find(readable, tagAssetId) ?? readable[0];
  const offRoute = status.distanceFromRouteKm > ROUTE_DEVIATION_KM;
  const limit = s.settings.stopAlertMinutes;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm text-slate-700">
          Driving <strong>{vehicle.registration}</strong> to {destination.name}
          {status.mode === "OFF_ROUTE" ? " on a detour" : ""} at {status.speed}× real time.
        </p>
        <div className="h-2 overflow-hidden rounded-full bg-slate-200">
          <div
            className={cx("h-full rounded-full transition-all", offRoute ? "bg-red-500" : "bg-blue-600")}
            style={{ width: `${Math.min(100, (status.doneKm / status.totalKm) * 100)}%` }}
          />
        </div>
        <p className="text-xs text-slate-500">
          {formatKm(Math.min(status.doneKm, status.totalKm))} of {formatKm(status.totalKm)} ·{" "}
          <span className={offRoute ? "font-medium text-red-600" : undefined}>{formatKm(status.distanceFromRouteKm)} from the planned route</span>
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => setPaused(!status.paused)}>
          {status.paused ? <Play className="size-4" aria-hidden /> : <CirclePause className="size-4" aria-hidden />}
          {status.paused ? "Drive on" : "Stop the vehicle"}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => stopSimulation()}>
          <Square className="size-4" aria-hidden /> End simulation
        </Button>
      </div>
      {status.paused && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">
          Standing still for {formatDuration(status.stoppedMinutes)}. An unscheduled-stop alert fires at {formatDuration(limit)} (set under Admin).
        </p>
      )}

      <div>
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-600">
          <Footprints className="size-3.5" aria-hidden /> Crew (RFID badges and phones)
        </p>
        <ul className="space-y-1">
          {crew.map((m) => {
            const away = status.awayCrewIds.includes(m.id);
            const km = personStatus(s, m).distanceFromVehicleKm;
            return (
              <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
                <span className={cx("min-w-0 truncate", away ? "text-red-600" : "text-slate-800")}>
                  {m.name} <span className="text-xs text-slate-500">· {m.duty ? LABEL.crewRole[m.duty] : "Crew"}</span>
                  {away && <span className="text-xs"> · out, {km !== null ? `${formatKm(km)} away` : "walking off"}</span>}
                </span>
                <Button size="sm" variant={away ? "secondary" : "ghost"} onClick={() => setCrewAway(m.id, !away)}>
                  {away ? "Back in" : "Step out"}
                </Button>
              </li>
            );
          })}
        </ul>
      </div>

      <div>
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-600">
          <Tag className="size-3.5" aria-hidden /> Asset tags
        </p>
        {tagAsset && (
          <div className="flex gap-2">
            <select className={cx(inputClass, "min-w-0")} value={tagAsset.id} onChange={(e) => setTagAssetId(e.target.value)} aria-label="Asset whose tag goes missing">
              {readable.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.serial}
                </option>
              ))}
            </select>
            <Button size="sm" variant="secondary" className="shrink-0" onClick={() => setTagLost(tagAsset.id, true)}>
              Lose tag
            </Button>
          </div>
        )}
        {status.lostAssetIds.map((id) => {
          const asset = find(s.assets, id);
          return asset ? (
            <p key={id} className="mt-1.5 flex items-center justify-between gap-2 text-sm text-red-600">
              {asset.serial} not detected
              <Button size="sm" variant="ghost" onClick={() => setTagLost(id, false)}>
                Tag found
              </Button>
            </p>
          ) : null;
        })}
      </div>
    </div>
  );
}
