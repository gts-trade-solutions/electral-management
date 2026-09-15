"use client";

import { ArrowLeft, CircleCheck, Navigation, Plus, Truck, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { closeTrip, dispatchTrip, pickAssets, recordCustodyBatch, unpickAsset } from "@/lib/domain";
import { formatKm, LABEL, sastDateTime, timeAgo } from "@/lib/format";
import { execute, useCan, useData, useNow, useUser } from "@/lib/hooks";
import { distanceFromRouteKm } from "@/lib/rules";
import {
  crewOf,
  find,
  lastPing,
  onboard,
  pickableAssets,
  tripManifest,
  tripParts,
  tripReconciliation,
  type ManifestRow,
  type ManifestStatus,
} from "@/lib/selectors";
import { toast } from "@/lib/toast";
import { AssetType, CustodyEventType, TripState, type Trip } from "@/lib/types";
import { useHandoffGps } from "../GpsStatus";
import { Badge, Button, Card, chipClass, cx, Empty, Field, inputClass, Stat, TRIP_STATE_TONE, type Tone } from "../ui";

export function TripDetail({ tripId, onBack }: { tripId: string; onBack: () => void }) {
  const s = useData();
  const user = useUser();
  const allowed = useCan();
  const now = useNow(15_000);
  const trip = find(s.trips, tripId);
  if (!trip) return <Empty title="Trip not found">A demo reset may have removed it.</Empty>;

  const { origin, destination, vehicle, driver } = tripParts(s, trip);
  const crew = crewOf(s, vehicle.id);
  const manifest = tripManifest(s, trip.id);
  const picked = manifest.filter((r) => r.status === "PICKED");
  const onVehicle = manifest.filter((r) => r.status === "LOADED");
  const loaded = manifest.filter((r) => r.load).length;
  const received = manifest.filter((r) => r.receive).length;
  const recon = tripReconciliation(s, trip.id);
  const ping = lastPing(s, trip.id);
  const reader = onboard(s, vehicle);
  const openAlerts = s.alerts.filter((a) => a.tripId === trip.id && !a.acknowledged).length;
  const serial = (id: string) => find(s.assets, id)?.serial ?? id;
  const reconciling = trip.state === TripState.ARRIVED || trip.state === TripState.CLOSED;

  const dispatch = () =>
    execute(
      (st) => dispatchTrip(st, user, trip.id, new Date()),
      `${vehicle.registration} dispatched. Start the simulator on the map to watch it move.`,
    );

  const close = () => {
    const result = execute((st) => closeTrip(st, user, trip.id, new Date()));
    if (!result) return;
    if (result.closed) toast.success("Manifest reconciled. Trip closed.");
    else toast.error("Closure blocked: the manifest doesn't reconcile. A MANIFEST_MISMATCH alert has been raised.");
  };

  return (
    <div className="space-y-4">
      <div>
        <button type="button" onClick={onBack} className="mb-2 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 lg:hidden">
          <ArrowLeft className="size-4" aria-hidden /> All trips
        </button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-slate-900">
              {origin.name} → {destination.name}
            </h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-sm text-slate-500">
              <Truck className="size-4" aria-hidden />
              <Link href={`/vehicles?id=${vehicle.id}`} className="font-medium text-slate-700 hover:underline">
                {vehicle.registration}
              </Link>
              {driver ? (
                <>
                  · {driver.name}
                  {driver.phone && (
                    <>
                      {" · "}
                      <a href={`tel:${driver.phone}`} className="hover:underline">
                        {driver.phone}
                      </a>
                    </>
                  )}
                </>
              ) : (
                <span className="text-amber-700">· no driver assigned</span>
              )}
            </p>
            {trip.state !== TripState.CLOSED && crew.length > 0 && (
              <p className="mt-1 text-xs text-slate-500">
                People on {vehicle.registration}:{" "}
                {crew.map((c, i) => (
                  <span key={c.id}>
                    {i > 0 && ", "}
                    <Link href={`/people?id=${c.id}`} className="text-blue-700 hover:underline">
                      {c.name}
                    </Link>
                    {c.duty && ` (${LABEL.crewRole[c.duty].toLowerCase()})`}
                  </span>
                ))}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {openAlerts > 0 && <Badge tone="red">{openAlerts} open alert{openAlerts === 1 ? "" : "s"}</Badge>}
            <Badge tone={TRIP_STATE_TONE[trip.state]}>{LABEL.tripState[trip.state]}</Badge>
          </div>
        </div>
      </div>

      <Stepper trip={trip} />

      <div className="grid grid-cols-3 gap-2">
        <Stat label="On manifest" value={manifest.length} />
        <Stat label="Loaded" value={loaded} />
        <Stat label="Received" value={received} tone={reconciling ? (recon.balanced ? "emerald" : "red") : undefined} />
      </div>

      {trip.state === TripState.PLANNED && (
        <>
          {allowed("editManifest") && <PickPanel trip={trip} />}
          {allowed("recordCustody") && picked.length > 0 && <HandoffPanel mode="LOAD" trip={trip} rows={picked} />}
          {allowed("dispatchTrip") && (
            <Card title="Dispatch" subtitle="The vehicle needs a driver, and every picked asset has to be loaded first.">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-slate-600">
                  {!driver
                    ? `${vehicle.registration} has no driver. Assign one on the Vehicles screen.`
                    : loaded === 0
                      ? "Nothing is loaded yet. An officer loads the picked assets."
                      : picked.length
                        ? `${picked.length} picked asset${picked.length === 1 ? " is" : "s are"} not loaded yet.`
                        : `${loaded} asset${loaded === 1 ? "" : "s"} loaded and sealed. Ready to go.`}
                </p>
                <Button onClick={dispatch} disabled={!driver || loaded === 0 || picked.length > 0}>
                  <Navigation className="size-4" aria-hidden /> Dispatch
                </Button>
              </div>
            </Card>
          )}
        </>
      )}

      {trip.state === TripState.IN_TRANSIT && (
        <Card
          title="On the road"
          action={
            <Link href={`/map?trip=${trip.id}`} className="text-sm font-medium text-blue-700 hover:underline">
              Track on map
            </Link>
          }
        >
          <p className="text-sm text-slate-600">
            Departed {sastDateTime(trip.departedAt)} SAST.{" "}
            {ping
              ? `Last GPS ping ${timeAgo(ping.recordedAt, now)}, ${formatKm(distanceFromRouteKm(trip.plannedRoute, ping))} from the planned route.`
              : "No GPS ping yet."}
          </p>
          {reader.live && (
            <p className="mt-1 text-sm text-slate-600">
              RFID: {reader.crew.filter((c) => c.detected).length} of {reader.crew.length} crew and{" "}
              {reader.assets.filter((a) => a.detected).length} of {reader.assets.length} assets detected on board, read {timeAgo(reader.readAt, now)}.{" "}
              <Link href={`/vehicles?id=${vehicle.id}`} className="font-medium text-blue-700 hover:underline">
                Vehicle details
              </Link>
            </p>
          )}
          <p className="mt-1 text-xs text-slate-500">
            It becomes Arrived when a ping lands at {destination.name}, or when the first asset is received there.
          </p>
        </Card>
      )}

      {(trip.state === TripState.IN_TRANSIT || trip.state === TripState.ARRIVED) && (
        <>
          {allowed("recordCustody") && onVehicle.length > 0 && <HandoffPanel mode="RECEIVE" trip={trip} rows={onVehicle} />}
          {allowed("closeTrip") && (
            <Card title="Reconcile and close" subtitle="Every asset loaded at the origin must be received at the destination.">
              {recon.balanced ? (
                <p className="text-sm text-emerald-700">All {recon.loaded.length} loaded assets have been received. The manifest reconciles.</p>
              ) : (
                <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800 ring-1 ring-inset ring-red-200">
                  <p className="font-medium">
                    {recon.loaded.length} loaded, {recon.received.length} received. Closing now is blocked and raises a manifest-mismatch alert.
                  </p>
                  {recon.missing.length > 0 && (
                    <p className="mt-1">
                      Not received: <span className="font-mono">{recon.missing.map(serial).join(", ")}</span>
                    </p>
                  )}
                  {recon.unexpected.length > 0 && (
                    <p className="mt-1">
                      Received but never loaded: <span className="font-mono">{recon.unexpected.map(serial).join(", ")}</span>
                    </p>
                  )}
                </div>
              )}
              <div className="mt-3 flex justify-end">
                <Button onClick={close} disabled={trip.state !== TripState.ARRIVED} variant={recon.balanced ? "primary" : "danger"}>
                  {trip.state === TripState.ARRIVED ? "Close trip" : "Close (once arrived)"}
                </Button>
              </div>
            </Card>
          )}
        </>
      )}

      {trip.state === TripState.CLOSED && (
        <Card>
          <p className="flex items-center gap-2 text-sm text-emerald-700">
            <CircleCheck className="size-4 shrink-0" aria-hidden />
            Closed {sastDateTime(trip.closedAt)} SAST. All {recon.loaded.length} assets loaded at {origin.name} were received at {destination.name}.
          </p>
        </Card>
      )}

      <ManifestTable trip={trip} rows={manifest} />
    </div>
  );
}

const STEPS: { state: TripState; at: (t: Trip) => string | null }[] = [
  { state: TripState.PLANNED, at: (t) => t.createdAt },
  { state: TripState.IN_TRANSIT, at: (t) => t.departedAt },
  { state: TripState.ARRIVED, at: (t) => t.arrivedAt },
  { state: TripState.CLOSED, at: (t) => t.closedAt },
];

const STEP_BAR: Record<TripState, string> = {
  PLANNED: "bg-slate-500",
  IN_TRANSIT: "bg-blue-600",
  ARRIVED: "bg-amber-500",
  CLOSED: "bg-emerald-600",
};

function Stepper({ trip }: { trip: Trip }) {
  const current = STEPS.findIndex((step) => step.state === trip.state);
  return (
    <ol className="grid grid-cols-4 gap-1.5">
      {STEPS.map((step, i) => {
        const time = step.at(trip);
        return (
          <li key={step.state} className="min-w-0">
            <div className={cx("h-1.5 rounded-full", i < current ? "bg-slate-800" : i === current ? STEP_BAR[trip.state] : "bg-slate-200")} />
            <p className={cx("mt-1.5 truncate text-xs font-medium", i <= current ? "text-slate-900" : "text-slate-400")}>
              {LABEL.tripState[step.state]}
            </p>
            <p className="truncate text-[11px] text-slate-500">{i <= current && time ? sastDateTime(time) : "—"}</p>
          </li>
        );
      })}
    </ol>
  );
}

/** Coordinator: choose what the trip will carry. Planning only; custody moves at loading. */
function PickPanel({ trip }: { trip: Trip }) {
  const s = useData();
  const user = useUser();
  const origin = find(s.facilities, trip.originFacilityId);
  const available = pickableAssets(s, trip);
  const [type, setType] = useState<AssetType | "ALL">("ALL");
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  const shown = available.filter((a) => type === "ALL" || a.type === type);
  const selected = available.filter((a) => chosen.has(a.id));
  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const add = () => {
    if (execute((st) => pickAssets(st, user, trip.id, selected.map((a) => a.id)), `${selected.length} added to the manifest.`)) {
      setChosen(new Set());
    }
  };

  return (
    <Card title="Pick assets" subtitle={`${available.length} available at ${origin?.name}. Picking plans the load; custody only moves when an officer loads it.`}>
      {available.length === 0 ? (
        <Empty title="Nothing left to pick at this facility" />
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {(["ALL", AssetType.VMD, AssetType.BALLOT_BOX, AssetType.BALLOT_PAPERS] as const).map((t) => (
              <button key={t} type="button" onClick={() => setType(t)} className={chipClass(type === t)}>
                {t === "ALL" ? "All" : LABEL.assetType[t]}{" "}
                <span className="opacity-60">{t === "ALL" ? available.length : available.filter((a) => a.type === t).length}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setChosen(new Set([...chosen, ...shown.map((a) => a.id)]))}
              className="ml-auto text-xs font-medium text-blue-700 hover:underline"
            >
              Select all shown
            </button>
          </div>
          <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg ring-1 ring-slate-200">
            {shown.map((a) => (
              <li key={a.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-slate-50">
                  <input type="checkbox" checked={chosen.has(a.id)} onChange={() => toggle(a.id)} className="size-4 accent-slate-900" />
                  <span className="font-mono text-sm">{a.serial}</span>
                  <span className="ml-auto text-xs text-slate-500">{LABEL.assetType[a.type]}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex justify-end">
            <Button onClick={add} disabled={!selected.length}>
              <Plus className="size-4" aria-hidden /> Add {selected.length || ""} to manifest
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

/** Officer: bulk LOAD at the origin or RECEIVE at the destination. One custody record per asset. */
function HandoffPanel({ mode, trip, rows }: { mode: "LOAD" | "RECEIVE"; trip: Trip; rows: ManifestRow[] }) {
  const s = useData();
  const user = useUser();
  const { origin, destination, vehicle } = tripParts(s, trip);
  const gps = useHandoffGps(mode === "LOAD" ? origin : destination);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [crateSeal, setCrateSeal] = useState(""); // LOAD: one seal for the crate or cage
  const [seals, setSeals] = useState<Record<string, string>>({}); // RECEIVE: what's on each item

  const chosen = rows.filter((r) => !excluded.has(r.asset.id));
  const sealFor = (r: ManifestRow) => (mode === "LOAD" ? crateSeal : (seals[r.asset.id] ?? r.load?.sealNumber ?? ""));
  const differs = (r: ManifestRow) =>
    mode === "RECEIVE" && !!r.load?.sealNumber && sealFor(r).trim().toUpperCase() !== r.load.sealNumber;
  const toggle = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = () => {
    const fix = gps.fix;
    if (!fix) {
      toast.error("Waiting for a GPS fix: every hand-off records where it happened.");
      return;
    }
    const type = mode === "LOAD" ? CustodyEventType.LOAD : CustodyEventType.RECEIVE;
    const result = execute(
      (st) =>
        recordCustodyBatch(
          st,
          user,
          chosen.map((r) => ({ assetId: r.asset.id, type, tripId: trip.id, sealNumber: sealFor(r), gps: fix })),
          new Date(),
        ),
      (r) => (mode === "LOAD" ? `Loaded ${r.events.length} onto ${vehicle.registration}.` : `Received ${r.events.length} at ${destination.name}.`),
    );
    if (result) {
      setExcluded(new Set());
      setSeals({});
    }
  };

  return (
    <Card
      title={mode === "LOAD" ? `Load onto ${vehicle.registration}` : `Receive at ${destination.name}`}
      subtitle={
        mode === "LOAD"
          ? "Each asset gets its own custody record: your name, this GPS fix and the seal."
          : "Untick anything that isn't on the vehicle, and check each seal against what was loaded."
      }
    >
      <div className="space-y-3">
        {gps.status}
        {mode === "LOAD" && (
          <Field label="Seal number" hint="The seal on the crate or cage these assets travel in.">
            <input
              className={cx(inputClass, "font-mono uppercase")}
              value={crateSeal}
              onChange={(e) => setCrateSeal(e.target.value)}
              placeholder="SL-300001"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
        )}
        <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg ring-1 ring-slate-200">
          {rows.map((r) => {
            const included = !excluded.has(r.asset.id);
            return (
              <li key={r.asset.id} className="flex items-center gap-3 px-3 py-2">
                <input
                  type="checkbox"
                  checked={included}
                  onChange={() => toggle(r.asset.id)}
                  className="size-4 accent-slate-900"
                  aria-label={`Include ${r.asset.serial}`}
                />
                <span className={cx("whitespace-nowrap font-mono text-sm", !included && "text-slate-400 line-through")}>{r.asset.serial}</span>
                <span className="hidden text-xs text-slate-500 sm:inline">{LABEL.assetType[r.asset.type]}</span>
                {mode === "RECEIVE" && (
                  <div className="ml-auto w-36 shrink-0">
                    <input
                      className={cx(inputClass, "py-1 font-mono text-xs uppercase", differs(r) && "ring-2 ring-red-400")}
                      value={sealFor(r)}
                      onChange={(e) => setSeals((prev) => ({ ...prev, [r.asset.id]: e.target.value }))}
                      disabled={!included}
                      aria-label={`Seal found on ${r.asset.serial}`}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {rows.some(differs) && (
          <p className="text-xs font-medium text-red-600">A seal differs from the one recorded at loading. Record what you actually see.</p>
        )}
        {mode === "RECEIVE" && chosen.length < rows.length && (
          <p className="text-xs text-amber-700">
            {rows.length - chosen.length} asset{rows.length - chosen.length === 1 ? "" : "s"} will stay unreceived, so the trip won&apos;t close.
          </p>
        )}
        <div className="flex justify-end">
          <Button onClick={submit} disabled={!chosen.length || !gps.fix || (mode === "LOAD" && !crateSeal.trim())}>
            {mode === "LOAD" ? `Load ${chosen.length}` : `Receive ${chosen.length}`}
          </Button>
        </div>
      </div>
    </Card>
  );
}

const STATUS: Record<ManifestStatus, { label: string; tone: Tone }> = {
  PICKED: { label: "Picked", tone: "slate" },
  LOADED: { label: "Loaded", tone: "blue" },
  RECEIVED: { label: "Received", tone: "emerald" },
  REPORTED_MISSING: { label: "Reported missing", tone: "red" },
};

function ManifestTable({ trip, rows }: { trip: Trip; rows: ManifestRow[] }) {
  const user = useUser();
  const allowed = useCan();
  const canUnpick = trip.state === TripState.PLANNED && allowed("editManifest");
  const statusOf = (r: ManifestRow) =>
    r.status === "LOADED" && (trip.state === TripState.ARRIVED || trip.state === TripState.CLOSED)
      ? { label: "Not received", tone: "red" as Tone }
      : STATUS[r.status];

  return (
    <Card title="Manifest" subtitle="Everything picked for, loaded onto or received off this trip." flush>
      {rows.length === 0 ? (
        <div className="p-4">
          <Empty title="Nothing on the manifest yet" />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Serial</th>
                <th className="hidden px-4 py-2 font-medium sm:table-cell">Type</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="hidden px-4 py-2 font-medium sm:table-cell">Load seal</th>
                <th className="hidden px-4 py-2 font-medium sm:table-cell">Receive seal</th>
                {canUnpick && <th className="w-10" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const status = statusOf(r);
                const sealDiffers = !!r.load && !!r.receive && r.load.sealNumber !== r.receive.sealNumber;
                return (
                  <tr key={r.asset.id}>
                    <td className="px-4 py-2">
                      <Link
                        href={`/assets?asset=${encodeURIComponent(r.asset.serial)}`}
                        className="whitespace-nowrap font-mono text-blue-700 hover:underline"
                      >
                        {r.asset.serial}
                      </Link>
                      {/* Phones: the seals sit under the serial instead of in their own columns. */}
                      {r.load && (
                        <div className={cx("mt-0.5 whitespace-nowrap font-mono text-xs sm:hidden", sealDiffers ? "text-red-600" : "text-slate-500")}>
                          Seal {r.load.sealNumber ?? "—"}
                          {r.receive && ` → ${r.receive.sealNumber ?? "—"}`}
                        </div>
                      )}
                    </td>
                    <td className="hidden px-4 py-2 text-slate-600 sm:table-cell">{LABEL.assetType[r.asset.type]}</td>
                    <td className="px-4 py-2">
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </td>
                    <td className="hidden whitespace-nowrap px-4 py-2 font-mono text-xs text-slate-600 sm:table-cell">{r.load?.sealNumber ?? "—"}</td>
                    <td
                      className={cx(
                        "hidden whitespace-nowrap px-4 py-2 font-mono text-xs sm:table-cell",
                        sealDiffers ? "font-semibold text-red-600" : "text-slate-600",
                      )}
                    >
                      {r.receive?.sealNumber ?? "—"}
                    </td>
                    {canUnpick && (
                      <td className="px-2 py-2 text-right">
                        {r.status === "PICKED" && (
                          <button
                            type="button"
                            aria-label={`Remove ${r.asset.serial} from the manifest`}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                            onClick={() => execute((st) => unpickAsset(st, user, trip.id, r.asset.id))}
                          >
                            <X className="size-4" />
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
