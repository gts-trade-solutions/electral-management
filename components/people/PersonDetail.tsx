"use client";

import { ArrowLeft, History, MapPin, Pencil, Route as RouteIcon, Truck } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { assignToVehicle, updateUser } from "@/lib/domain";
import { LABEL, sastDateTime, timeAgo } from "@/lib/format";
import { execute, useCan, useData, useNow, useUser } from "@/lib/hooks";
import { crewOf, find, lastPing, openTripFor, personStatus, roadTripFor, tripParts, userTrail } from "@/lib/selectors";
import { ActivityKind, CrewRole, PingSource, RfidEventKind, TripState, type DemoState, type Trip, type User } from "@/lib/types";
import { formatTag } from "@/lib/validate";
import type { MiniMapLine, MiniMapPoint } from "../MiniMap";
import { ALERT_TONE, Badge, Button, Card, cx, Empty, Field, inputClass, PERSON_STATE_COLOR, PERSON_STATE_TONE, Stat, TRIP_STATE_TONE, type Tone } from "../ui";

const MiniMap = dynamic(() => import("../MiniMap").then((m) => m.MiniMap), {
  ssr: false,
  loading: () => <div className="h-64 animate-pulse rounded-lg bg-slate-100" />,
});

const ACTIVITY_TONE: Record<ActivityKind, Tone> = {
  SESSION: "slate",
  TRIP: "blue",
  MANIFEST: "violet",
  HANDOFF: "emerald",
  ALERT: "amber",
  VEHICLE: "slate",
  ASSIGNMENT: "orange",
  ACCOUNT: "slate",
  SETTINGS: "slate",
};

/** The trail shown on a person's map: their last 12 hours. */
const TRAIL_MS = 12 * 3_600_000;

export function PersonDetail({ userId, onBack }: { userId: string; onBack?: () => void }) {
  const s = useData();
  const allowed = useCan();
  const now = useNow(10_000);
  const [editing, setEditing] = useState(false);
  const person = find(s.users, userId);
  if (!person) return <Empty title="Person not found">A demo reset may have removed them.</Empty>;

  const status = personStatus(s, person);
  const vehicle = status.vehicle;
  const roadTrip = vehicle ? roadTripFor(s, vehicle.id) : undefined;
  const position = status.position;
  const trail = userTrail(s, person.id).filter((p) => now - Date.parse(p.recordedAt) <= TRAIL_MS);
  const actionsToday = s.activity.filter((e) => e.userId === person.id && now - Date.parse(e.at) <= 24 * 3_600_000).length;

  const points: MiniMapPoint[] = [];
  if (roadTrip) {
    const parts = tripParts(s, roadTrip);
    points.push(
      { lat: parts.origin.lat, lng: parts.origin.lng, color: "#0f172a", label: "Origin", radius: 5 },
      { lat: parts.destination.lat, lng: parts.destination.lng, color: "#059669", label: "Destination", radius: 5 },
    );
    const at = lastPing(s, roadTrip.id);
    if (at) points.push({ lat: at.lat, lng: at.lng, color: "#0f172a", label: parts.vehicle.registration, radius: 7 });
  }
  if (position) points.push({ lat: position.lat, lng: position.lng, color: PERSON_STATE_COLOR[status.state], label: person.name, radius: 8 });
  const lines: MiniMapLine[] = trail.length > 1 ? [{ coordinates: trail.map((p) => [p.lng, p.lat]), color: "#7c3aed", width: 3 }] : [];

  return (
    <div className="space-y-4">
      <div>
        {onBack && (
          <button type="button" onClick={onBack} className="mb-2 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
            <ArrowLeft className="size-4" aria-hidden /> Everyone
          </button>
        )}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-slate-900">
              {person.name}
              <Badge>{LABEL.role[person.role]}</Badge>
              {!person.active && <Badge tone="slate">Deactivated</Badge>}
            </h1>
            <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
              <span>{person.email}</span>
              {person.phone && (
                <a href={`tel:${person.phone}`} className="hover:underline">
                  {person.phone}
                </a>
              )}
              {person.rfidBadge && (
                <span>
                  Badge <span className="font-mono text-slate-700">{formatTag(person.rfidBadge)}</span>
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={PERSON_STATE_TONE[status.state]}>{status.label}</Badge>
            {allowed("manageUsers") && !editing && (
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                <Pencil className="size-4" aria-hidden /> Edit
              </Button>
            )}
          </div>
        </div>
      </div>

      {editing && <DetailsForm person={person} onDone={() => setEditing(false)} />}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Vehicle" value={vehicle ? vehicle.registration : "—"} />
        <Stat label="Duty" value={person.duty ? LABEL.crewRole[person.duty] : "—"} />
        <Stat label="Last seen" value={position ? timeAgo(position.recordedAt, now) : "Never"} tone={status.state === "AWAY" ? "red" : undefined} />
        <Stat label="Actions, 24 h" value={actionsToday} />
      </div>

      <Card
        title="Location"
        subtitle="From the phone they're signed in on. The purple line is where they've been in the last 12 hours."
        action={
          position && (
            <Link
              href={`/map?at=${position.lat},${position.lng}&label=${encodeURIComponent(person.name)}`}
              className="flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline"
            >
              <MapPin className="size-4" aria-hidden /> Open on map
            </Link>
          )
        }
      >
        {points.length > 0 ? (
          <MiniMap points={points} lines={lines} frameKey={person.id} className="h-64 w-full overflow-hidden rounded-lg ring-1 ring-slate-200" />
        ) : (
          <Empty title="No location yet">Their phone hasn&apos;t reported a position.</Empty>
        )}
        {position && (
          <p className="mt-2 text-sm text-slate-600">
            {status.label}. Last report {sastDateTime(position.recordedAt)} SAST
            {position.accuracyM !== null && `, ±${position.accuracyM} m`}
            {position.source === PingSource.SIMULATED ? " (simulated phone)" : " (phone GPS)"}.
            {status.badgeRead === false && person.rfidBadge && " Their badge was not read by the vehicle's reader on its last read."}
          </p>
        )}
      </Card>

      <AssignmentCard key={`${person.id}:${person.vehicleId}:${person.duty}`} person={person} />
      <TripsCard person={person} />
      <TimelineCard person={person} />
    </div>
  );
}

function AssignmentCard({ person }: { person: User }) {
  const s = useData();
  const me = useUser();
  const allowed = useCan();
  const vehicle = find(s.vehicles, person.vehicleId);
  const mates = vehicle ? crewOf(s, vehicle.id) : [];
  const onRoad = (id: string) => openTripFor(s, id)?.state === TripState.IN_TRANSIT;
  const locked = !!vehicle && onRoad(vehicle.id);
  const [vehicleId, setVehicleId] = useState(person.vehicleId ?? "");
  const [duty, setDuty] = useState<CrewRole>(person.duty ?? CrewRole.ESCORT);
  const target = find(s.vehicles, vehicleId);

  const save = () =>
    execute(
      (st) => assignToVehicle(st, me, person.id, vehicleId || null, vehicleId ? duty : null, new Date()),
      target ? `${person.name} is on ${target.registration} as ${LABEL.crewRole[duty].toLowerCase()}.` : `${person.name} is no longer on a vehicle.`,
    );

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Truck className="size-4" aria-hidden /> Vehicle
        </span>
      }
      subtitle={
        vehicle
          ? `${LABEL.crewRole[person.duty ?? CrewRole.ESCORT]} on ${vehicle.registration}, with ${mates.length} of ${vehicle.seats} seats taken.`
          : "Not assigned to a vehicle."
      }
    >
      {vehicle && (
        <ul className="mb-3 space-y-1.5">
          {mates.map((m) => {
            const st = personStatus(s, m);
            return (
              <li key={m.id} className="flex items-center gap-2 text-sm">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: PERSON_STATE_COLOR[st.state] }} aria-hidden />
                <Link href={`/people?id=${m.id}`} className={cx("font-medium hover:underline", m.id === person.id ? "text-slate-900" : "text-blue-700")}>
                  {m.name}
                </Link>
                <span className="text-xs text-slate-500">· {m.duty ? LABEL.crewRole[m.duty] : "Crew"}</span>
                <span className="ml-auto truncate text-xs text-slate-500">{st.label}</span>
              </li>
            );
          })}
          <li>
            <Link href={`/vehicles?id=${vehicle.id}`} className="text-xs font-medium text-blue-700 hover:underline">
              Open {vehicle.registration}
            </Link>
          </li>
        </ul>
      )}
      {allowed("manageVehicles") && person.active && (
        locked ? (
          <p className="text-xs text-slate-500">Assignments are locked while {vehicle?.registration} is on the road.</p>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-44 flex-1">
              <Field label="Assign to">
                <select className={inputClass} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                  <option value="">Not on a vehicle</option>
                  {s.vehicles.map((v) => (
                    <option key={v.id} value={v.id} disabled={onRoad(v.id)}>
                      {v.registration} · {crewOf(s, v.id).length}/{v.seats} seats · {onRoad(v.id) ? "on the road" : LABEL.vehicleStatus[v.status].toLowerCase()}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {vehicleId && (
              <div className="w-44">
                <Field label="Duty">
                  <select className={inputClass} value={duty} onChange={(e) => setDuty(e.target.value as CrewRole)}>
                    {Object.values(CrewRole).map((r) => (
                      <option key={r} value={r}>
                        {LABEL.crewRole[r]}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            )}
            <Button variant="secondary" onClick={save} disabled={vehicleId === (person.vehicleId ?? "") && (!vehicleId || duty === person.duty)}>
              Save
            </Button>
          </div>
        )
      )}
    </Card>
  );
}

/** Trips they rode on, worked on, or whose vehicle they're assigned to. */
function tripsOf(s: DemoState, person: User): { trip: Trip; rode: boolean }[] {
  const rode = new Set<string>();
  const worked = new Set<string>();
  for (const p of s.userPings) if (p.userId === person.id && p.tripId) rode.add(p.tripId);
  for (const e of s.activity) if ((e.userId === person.id || e.subjectUserId === person.id) && e.tripId) worked.add(e.tripId);
  for (const e of s.custodyEvents) if (e.officerId === person.id && e.tripId) worked.add(e.tripId);
  const open = person.vehicleId ? openTripFor(s, person.vehicleId) : undefined;
  if (open) rode.add(open.id);
  return [...new Set([...rode, ...worked])]
    .map((id) => find(s.trips, id))
    .filter((t): t is Trip => !!t)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((trip) => ({ trip, rode: rode.has(trip.id) }));
}

function TripsCard({ person }: { person: User }) {
  const s = useData();
  const trips = tripsOf(s, person);
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <RouteIcon className="size-4" aria-hidden /> Trips · {trips.length}
        </span>
      }
      flush
    >
      {trips.length === 0 ? (
        <div className="p-4">
          <Empty title="No trips yet" />
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {trips.map(({ trip, rode }) => {
            const p = tripParts(s, trip);
            return (
              <li key={trip.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <Link href={`/trips?id=${trip.id}`} className="min-w-0 flex-1 truncate text-blue-700 hover:underline">
                  {p.vehicle.registration} · {p.origin.name} → {p.destination.name}
                </Link>
                <span className="hidden text-xs text-slate-500 sm:inline">{rode ? "On board" : "Worked on it"}</span>
                <Badge tone={TRIP_STATE_TONE[trip.state]}>{LABEL.tripState[trip.state]}</Badge>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

type Moment = { id: string; at: string; tag: string; tone: Tone; text: string; lat: number | null; lng: number | null };

/**
 * What they did, what was done to them, what happened on the trips they rode
 * (planning, loading, dispatch, gate reads, receipt, closure), RFID reads of
 * their badge, and the alerts about them or their vehicle on those trips.
 */
function timeline(s: DemoState, person: User): Moment[] {
  const moments: Moment[] = [];
  const rode = new Set(tripsOf(s, person).filter((t) => t.rode).map((t) => t.trip.id));
  const onRode = (tripId: string | null) => !!tripId && rode.has(tripId);

  for (const e of s.activity) {
    const involved = e.userId === person.id || e.subjectUserId === person.id;
    if (!involved && !onRode(e.tripId)) continue;
    const by = e.userId !== person.id ? (find(s.users, e.userId)?.name ?? "Someone") : null;
    moments.push({ id: e.id, at: e.at, tag: LABEL.activity[e.kind], tone: ACTIVITY_TONE[e.kind], text: by ? `${by}: ${e.summary}` : e.summary, lat: e.lat, lng: e.lng });
  }
  for (const e of s.rfidEvents) {
    const v = find(s.vehicles, e.vehicleId)?.registration ?? "The vehicle";
    if (e.subjectId === person.id) {
      moments.push({
        id: e.id,
        at: e.at,
        tag: "RFID",
        tone: e.kind === RfidEventKind.CREW_OFF ? "red" : "emerald",
        text: `${e.kind === RfidEventKind.CREW_OFF ? "Their badge stopped being read on" : "Their badge was read again on"} ${v}`,
        lat: e.lat,
        lng: e.lng,
      });
    } else if (!e.subjectId && onRode(e.tripId)) {
      moments.push({ id: e.id, at: e.at, tag: "RFID", tone: "slate", text: `${v} ${LABEL.rfid[e.kind].toLowerCase()}`, lat: e.lat, lng: e.lng });
    }
  }
  for (const a of s.alerts) {
    if (a.userId !== person.id && !onRode(a.tripId)) continue;
    moments.push({ id: a.id, at: a.createdAt, tag: LABEL.alertType[a.type], tone: a.acknowledged ? "slate" : ALERT_TONE[a.type], text: a.message, lat: a.lat, lng: a.lng });
  }
  return moments.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 150);
}

function TimelineCard({ person }: { person: User }) {
  const s = useData();
  const moments = timeline(s, person);
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <History className="size-4" aria-hidden /> Activity
        </span>
      }
      subtitle="Everything they did in the app, changes made to them, what happened on the trips they rode, RFID reads and alerts. Newest first."
      flush
    >
      {moments.length === 0 ? (
        <div className="p-4">
          <Empty title="Nothing recorded yet" />
        </div>
      ) : (
        <ol className="divide-y divide-slate-100">
          {moments.map((m) => (
            <li key={m.id} className="flex items-start gap-3 px-4 py-2.5">
              <Badge tone={m.tone} className="mt-0.5 shrink-0">
                {m.tag}
              </Badge>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-800">{m.text}</p>
                <p className="text-xs text-slate-500">
                  {sastDateTime(m.at)} SAST
                  {m.lat !== null && m.lng !== null && (
                    <>
                      {" · "}
                      <Link
                        href={`/map?at=${m.lat},${m.lng}&label=${encodeURIComponent(`${person.name}: ${m.tag}`)}`}
                        className="font-mono text-blue-700 hover:underline"
                      >
                        {m.lat.toFixed(4)}, {m.lng.toFixed(4)}
                      </Link>
                    </>
                  )}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function DetailsForm({ person, onDone }: { person: User; onDone: () => void }) {
  const me = useUser();
  const [name, setName] = useState(person.name);
  const [email, setEmail] = useState(person.email);
  const [phone, setPhone] = useState(person.phone ?? "");
  const [badge, setBadge] = useState(person.rfidBadge ? formatTag(person.rfidBadge) : "");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (execute((st) => updateUser(st, me, person.id, { name, email, phone, rfidBadge: badge }, new Date()), "Details saved.")) onDone();
  };

  return (
    <Card title="Edit details">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Full name">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Email">
            <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Mobile number">
            <input className={inputClass} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="082 123 4567" />
          </Field>
          <Field label="RFID badge" hint="24 hexadecimal characters. Leave empty if they have none.">
            <input className={cx(inputClass, "font-mono uppercase")} value={badge} onChange={(e) => setBadge(e.target.value)} spellCheck={false} />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit">Save</Button>
        </div>
      </form>
    </Card>
  );
}
