"use client";

import { ArrowLeft, MapPin, Pencil, Radio, UserPlus, X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { assignToVehicle, createUser } from "@/lib/domain";
import { formatKm, LABEL, sastDateTime, timeAgo } from "@/lib/format";
import { execute, useCan, useData, useNow, useUser } from "@/lib/hooks";
import { toLngLat } from "@/lib/rules";
import {
  crewOf,
  find,
  nearestFacility,
  onboard,
  openTripFor,
  personStatus,
  rfidSubject,
  tripParts,
  tripPings,
  vehiclePosition,
  vehicleRfidEvents,
  type Onboard,
} from "@/lib/selectors";
import { CrewRole, RfidEventKind, Role, TripState, VehicleStatus, type Vehicle } from "@/lib/types";
import { FIELD_PASSWORD } from "@/lib/users";
import { formatTag, randomEpc } from "@/lib/validate";
import type { MiniMapLine, MiniMapPoint } from "../MiniMap";
import { Badge, Button, Card, cx, Empty, Field, inputClass, PERSON_STATE_TONE, Stat, type Tone } from "../ui";
import { VehicleForm } from "./VehicleForm";

const MiniMap = dynamic(() => import("../MiniMap").then((m) => m.MiniMap), {
  ssr: false,
  loading: () => <div className="h-56 animate-pulse rounded-lg bg-slate-100" />,
});

export const VEHICLE_STATUS_TONE: Record<VehicleStatus, Tone> = { AVAILABLE: "emerald", ON_TRIP: "blue", OUT_OF_SERVICE: "slate" };

const RFID_DOT: Record<RfidEventKind, string> = {
  GATE_OUT: "bg-slate-500",
  GATE_IN: "bg-emerald-500",
  CREW_OFF: "bg-red-500",
  CREW_ON: "bg-emerald-500",
  ASSET_MISSING: "bg-red-500",
  ASSET_FOUND: "bg-emerald-500",
};

export function VehicleDetail({ vehicleId, onBack }: { vehicleId: string; onBack: () => void }) {
  const s = useData();
  const allowed = useCan();
  const now = useNow(5_000);
  const [editing, setEditing] = useState(false);
  const vehicle = find(s.vehicles, vehicleId);
  if (!vehicle) return <Empty title="Vehicle not found">A demo reset may have removed it.</Empty>;
  if (editing) return <VehicleForm vehicle={vehicle} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />;

  const trip = openTripFor(s, vehicle.id);
  const parts = trip ? tripParts(s, trip) : null;
  const reader = onboard(s, vehicle);
  const position = vehiclePosition(s, vehicle.id);
  const near = position ? nearestFacility(s, position) : null;
  const openAlerts = trip ? s.alerts.filter((a) => a.tripId === trip.id && !a.acknowledged).length : 0;
  const crewOn = reader.crew.filter((c) => c.detected).length;
  const assetsOn = reader.assets.filter((a) => a.detected).length;

  // The map: planned route, trail, where crew stepped out or tags went quiet, and the vehicle itself.
  const incidents = trip
    ? s.rfidEvents.filter((e) => e.tripId === trip.id && (e.kind === RfidEventKind.CREW_OFF || e.kind === RfidEventKind.ASSET_MISSING))
    : [];
  const points: MiniMapPoint[] = [
    ...(parts
      ? [
          { lat: parts.origin.lat, lng: parts.origin.lng, color: "#0f172a", label: "Origin", radius: 5 },
          { lat: parts.destination.lat, lng: parts.destination.lng, color: "#059669", label: "Destination", radius: 5 },
        ]
      : []),
    ...incidents.map((e) => ({ lat: e.lat, lng: e.lng, color: "#dc2626", label: rfidSubject(s, e) ?? "", radius: 5 })),
    ...(position ? [{ lat: position.lat, lng: position.lng, color: openAlerts ? "#dc2626" : "#2563eb", label: vehicle.registration, radius: 8 }] : []),
  ];
  const lines: MiniMapLine[] = trip
    ? [
        { coordinates: trip.plannedRoute.map(toLngLat), color: "#94a3b8", dashed: trip.state === TripState.PLANNED, width: 3 },
        { coordinates: tripPings(s, trip.id).map((p) => [p.lng, p.lat]), color: "#2563eb", width: 3 },
      ]
    : [];
  const mapHref =
    trip && trip.state !== TripState.PLANNED
      ? `/map?trip=${trip.id}`
      : position
        ? `/map?at=${position.lat},${position.lng}&label=${encodeURIComponent(vehicle.registration)}`
        : null;

  return (
    <div className="space-y-4">
      <div>
        <button type="button" onClick={onBack} className="mb-2 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 lg:hidden">
          <ArrowLeft className="size-4" aria-hidden /> All vehicles
        </button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-slate-900">{vehicle.registration}</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              {trip && parts ? (
                <>
                  {LABEL.tripState[trip.state]}:{" "}
                  <Link href={`/trips?id=${trip.id}`} className="text-blue-700 hover:underline">
                    {parts.origin.name} → {parts.destination.name}
                  </Link>
                </>
              ) : (
                "No open trip"
              )}
            </p>
            <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
              <span>
                Windscreen tag <span className="font-mono text-slate-700">{formatTag(vehicle.rfidTag)}</span>
              </span>
              <span>
                Reader <span className="font-mono text-slate-700">{vehicle.readerId}</span>
              </span>
              <span>{vehicle.seats} seats</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            {openAlerts > 0 && <Badge tone="red">{openAlerts} open alert{openAlerts === 1 ? "" : "s"}</Badge>}
            <Badge tone={VEHICLE_STATUS_TONE[vehicle.status]}>{LABEL.vehicleStatus[vehicle.status]}</Badge>
            {allowed("manageVehicles") && (
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                <Pencil className="size-4" aria-hidden /> Edit
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat
          label="People on board"
          value={reader.live ? `${crewOn}/${reader.crew.length}` : "—"}
          tone={reader.live ? (crewOn === reader.crew.length ? "emerald" : "red") : undefined}
        />
        <Stat
          label="Assets on board"
          value={reader.live ? `${assetsOn}/${reader.assets.length}` : reader.assets.length || "—"}
          tone={reader.live ? (assetsOn === reader.assets.length ? "emerald" : "red") : undefined}
        />
        <Stat label="Last RFID read" value={reader.live ? timeAgo(reader.readAt, now) : "Idle"} />
      </div>

      <Card
        title="Location"
        action={
          mapHref && (
            <Link href={mapHref} className="flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline">
              <MapPin className="size-4" aria-hidden /> Open on map
            </Link>
          )
        }
      >
        {points.length > 0 && <MiniMap points={points} lines={lines} frameKey={`${vehicle.id}:${trip?.id ?? "none"}`} />}
        <p className={cx("text-sm text-slate-600", points.length > 0 && "mt-2")}>
          {position && near
            ? `Last GPS position ${near.km < 0.3 ? `at ${near.facility.name}` : `${formatKm(near.km)} from ${near.facility.name}`}, ${timeAgo(position.recordedAt, now)}.`
            : "No GPS position yet. The tracker reports once the vehicle is on a trip."}
        </p>
      </Card>

      <CrewCard vehicle={vehicle} reader={reader} />
      <AssetsCard reader={reader} />
      <RfidLog vehicle={vehicle} />
    </div>
  );
}

function CrewCard({ vehicle, reader }: { vehicle: Vehicle; reader: Onboard }) {
  const s = useData();
  const user = useUser();
  const allowed = useCan();
  const manage = allowed("manageVehicles");
  const onRoad = (id: string | null) => !!id && openTripFor(s, id)?.state === TripState.IN_TRANSIT;
  const locked = onRoad(vehicle.id);
  // Anyone active who isn't on this vehicle; people on another vehicle that's on the road can't be moved.
  const pool = s.users
    .filter((u) => u.active && u.vehicleId !== vehicle.id && !onRoad(u.vehicleId))
    .sort((a, b) => Number(!!a.vehicleId) - Number(!!b.vehicleId) || a.name.localeCompare(b.name));
  const hasDriver = reader.crew.some((c) => c.member.duty === CrewRole.DRIVER);
  const [assignId, setAssignId] = useState("");
  const [duty, setDuty] = useState<CrewRole | null>(null);
  const [adding, setAdding] = useState(false);
  const toAssign = find(pool, assignId) ?? pool[0];
  const chosenDuty = duty ?? (hasDriver ? CrewRole.ESCORT : CrewRole.DRIVER);
  const detected = reader.crew.filter((c) => c.detected).length;
  const full = reader.crew.length >= vehicle.seats;

  const assign = () => {
    if (!toAssign) return;
    const from = find(s.vehicles, toAssign.vehicleId);
    execute(
      (st) => assignToVehicle(st, user, toAssign.id, vehicle.id, chosenDuty, new Date()),
      `${toAssign.name} ${from ? `moved from ${from.registration} to` : "assigned to"} ${vehicle.registration} as ${LABEL.crewRole[chosenDuty].toLowerCase()}.`,
    );
    setAssignId("");
    setDuty(null);
  };

  return (
    <Card
      title={`People on this vehicle · ${reader.crew.length} of ${vehicle.seats} seats`}
      subtitle={
        reader.live
          ? `${detected} of ${reader.crew.length} detected on board by their RFID badges. Each person's phone location is compared with the vehicle.`
          : "The in-cab reader starts counting badges when the trip is dispatched."
      }
      flush
    >
      {reader.crew.length === 0 ? (
        <div className="p-4">
          <Empty title="Nobody assigned" />
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {reader.crew.map(({ member, detected: seen }) => {
            const status = personStatus(s, member);
            return (
              <li key={member.id} className="flex items-center gap-3 px-4 py-2.5">
                <span
                  className={cx("size-2.5 shrink-0 rounded-full", !reader.live ? "bg-slate-300" : seen ? "bg-emerald-500" : "bg-red-500")}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">
                    <Link href={`/people?id=${member.id}`} className="hover:underline">
                      {member.name}
                    </Link>{" "}
                    <span className="font-normal text-slate-500">
                      · {member.duty ? LABEL.crewRole[member.duty] : "Crew"} · {LABEL.role[member.role]} account
                    </span>
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {member.phone && (
                      <>
                        <a href={`tel:${member.phone}`} className="hover:underline">
                          {member.phone}
                        </a>
                        {" · "}
                      </>
                    )}
                    {member.rfidBadge ? (
                      <>
                        badge <span className="font-mono">{formatTag(member.rfidBadge)}</span>
                      </>
                    ) : (
                      "no RFID badge"
                    )}
                    {status.position && ` · seen ${timeAgo(status.position.recordedAt)}`}
                  </p>
                </div>
                {reader.live ? (
                  <Badge tone={status.state === "AWAY" ? "red" : seen ? "emerald" : "red"}>
                    {status.state === "AWAY" ? status.label : seen ? "On board" : "Badge not read"}
                  </Badge>
                ) : (
                  <Badge tone={PERSON_STATE_TONE[status.state]} className="hidden sm:inline-flex">
                    {status.label}
                  </Badge>
                )}
                {manage && !locked && (
                  <button
                    type="button"
                    aria-label={`Take ${member.name} off ${vehicle.registration}`}
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    onClick={() => execute((st) => assignToVehicle(st, user, member.id, null, null, new Date()), `${member.name} taken off ${vehicle.registration}.`)}
                  >
                    <X className="size-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {manage && (
        <div className="space-y-3 border-t border-slate-100 p-4">
          {locked ? (
            <p className="text-xs text-slate-500">Assignments are locked while the vehicle is on the road.</p>
          ) : full ? (
            <p className="text-xs text-slate-500">All {vehicle.seats} seats are taken. Take someone off to assign another person.</p>
          ) : (
            <>
              {toAssign && (
                <div className="flex flex-wrap gap-2">
                  <select
                    className={cx(inputClass, "min-w-0 flex-1")}
                    value={toAssign.id}
                    onChange={(e) => setAssignId(e.target.value)}
                    aria-label="Person to assign"
                  >
                    {pool.map((p) => {
                      const on = find(s.vehicles, p.vehicleId);
                      return (
                        <option key={p.id} value={p.id}>
                          {p.name} · {LABEL.role[p.role]}
                          {on ? ` · now on ${on.registration}` : ""}
                        </option>
                      );
                    })}
                  </select>
                  <select
                    className={cx(inputClass, "w-44")}
                    value={chosenDuty}
                    onChange={(e) => setDuty(e.target.value as CrewRole)}
                    aria-label="Duty on this vehicle"
                  >
                    {Object.values(CrewRole).map((r) => (
                      <option key={r} value={r}>
                        {LABEL.crewRole[r]}
                      </option>
                    ))}
                  </select>
                  <Button variant="secondary" className="shrink-0" onClick={assign}>
                    Assign
                  </Button>
                </div>
              )}
              {allowed("manageUsers") &&
                (adding ? (
                  <AddPersonForm vehicle={vehicle} onDone={() => setAdding(false)} />
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
                    <UserPlus className="size-4" aria-hidden /> Add a new person to {vehicle.registration}
                  </Button>
                ))}
            </>
          )}
        </div>
      )}
    </Card>
  );
}

/** Admins: create an account for someone new and put them straight on this vehicle. */
function AddPersonForm({ vehicle, onDone }: { vehicle: Vehicle; onDone: () => void }) {
  const user = useUser();
  const s = useData();
  const hasDriver = crewOf(s, vehicle.id).some((c) => c.duty === CrewRole.DRIVER);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [duty, setDuty] = useState<CrewRole>(hasDriver ? CrewRole.ESCORT : CrewRole.DRIVER);
  const [phone, setPhone] = useState("");
  const [badge, setBadge] = useState(() => formatTag(randomEpc("E2003412")));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    // Electoral officers record hand-offs; everyone else on a vehicle is crew.
    const role = duty === CrewRole.ELECTORAL_OFFICER ? Role.OFFICER : Role.CREW;
    const result = execute(
      (st) => createUser(st, user, { name, email, role, password: FIELD_PASSWORD, phone, rfidBadge: badge, vehicleId: vehicle.id, duty }, new Date()),
      (r) => `${r.user.name} added to ${vehicle.registration}. They sign in with ${r.user.email} / ${FIELD_PASSWORD}.`,
    );
    if (result) onDone();
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Email (their sign-in)">
          <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" />
        </Field>
        <Field label="Duty on this vehicle">
          <select className={inputClass} value={duty} onChange={(e) => setDuty(e.target.value as CrewRole)}>
            {Object.values(CrewRole).map((r) => (
              <option key={r} value={r}>
                {LABEL.crewRole[r]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Mobile number">
          <input className={inputClass} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="082 123 4567" required />
        </Field>
        <Field label="RFID badge">
          <div className="flex gap-2">
            <input
              className={cx(inputClass, "min-w-0 font-mono uppercase")}
              value={badge}
              onChange={(e) => setBadge(e.target.value)}
              spellCheck={false}
              required
            />
            <Button variant="secondary" className="shrink-0" onClick={() => setBadge(formatTag(randomEpc("E2003412")))}>
              New
            </Button>
          </div>
        </Field>
      </div>
      <p className="text-xs text-slate-500">They get a sign-in with the password {FIELD_PASSWORD}, which an admin can change later.</p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit">Add to {vehicle.registration}</Button>
      </div>
    </form>
  );
}

function AssetsCard({ reader }: { reader: Onboard }) {
  const on = reader.assets.filter((a) => a.detected).length;
  return (
    <Card
      title={`Assets on board · ${reader.assets.length}`}
      subtitle={reader.live ? `${on} of ${reader.assets.length} detected by their RFID tags.` : "Loaded assets appear here; the reader starts counting at dispatch."}
      flush
    >
      {reader.assets.length === 0 ? (
        <div className="p-4">
          <Empty title="Nothing loaded" />
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {reader.assets.map(({ asset, detected }) => (
            <li key={asset.id} className="flex items-center gap-3 px-4 py-2">
              <span
                className={cx("size-2.5 shrink-0 rounded-full", !reader.live ? "bg-slate-300" : detected ? "bg-emerald-500" : "bg-red-500")}
                aria-hidden
              />
              <Link href={`/assets?asset=${encodeURIComponent(asset.serial)}`} className="font-mono text-sm text-blue-700 hover:underline">
                {asset.serial}
              </Link>
              <span className="hidden text-xs text-slate-500 sm:inline">{LABEL.assetType[asset.type]}</span>
              <span className="ml-auto hidden font-mono text-xs text-slate-400 md:inline">{formatTag(asset.rfidTag)}</span>
              {reader.live && <Badge tone={detected ? "emerald" : "red"}>{detected ? "Detected" : "Not detected"}</Badge>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RfidLog({ vehicle }: { vehicle: Vehicle }) {
  const s = useData();
  const events = vehicleRfidEvents(s, vehicle.id, 25);
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Radio className="size-4" aria-hidden /> RFID activity
        </span>
      }
      subtitle="Gate reads of the windscreen tag, and badges or tags appearing and disappearing on board. Newest first."
      flush
    >
      {events.length === 0 ? (
        <div className="p-4">
          <Empty title="No reads yet" />
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {events.map((e) => {
            const subject = rfidSubject(s, e);
            return (
              <li key={e.id} className="flex items-start gap-3 px-4 py-2 text-sm">
                <span className={cx("mt-1.5 size-2 shrink-0 rounded-full", RFID_DOT[e.kind])} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-slate-800">
                    {LABEL.rfid[e.kind]}
                    {subject ? `: ${subject}` : ""}
                  </p>
                  <p className="text-xs text-slate-500">
                    {sastDateTime(e.at)} SAST ·{" "}
                    <Link
                      href={`/map?at=${e.lat},${e.lng}&label=${encodeURIComponent(LABEL.rfid[e.kind])}`}
                      className="font-mono text-blue-700 hover:underline"
                    >
                      {e.lat.toFixed(4)}, {e.lng.toFixed(4)}
                    </Link>
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
