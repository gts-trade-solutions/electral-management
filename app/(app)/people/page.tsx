"use client";

import { TriangleAlert } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import type { MiniMapPoint } from "@/components/MiniMap";
import { PersonDetail } from "@/components/people/PersonDetail";
import { Badge, Card, chipClass, cx, Empty, PERSON_STATE_COLOR, PERSON_STATE_TONE, Stat } from "@/components/ui";
import { VEHICLE_STATUS_TONE } from "@/components/vehicles/VehicleDetail";
import { LABEL, sastTime, timeAgo } from "@/lib/format";
import { useCan, useData, useNow, useUser } from "@/lib/hooks";
import { crewOf, find, lastPing, onboard, personStatus, roadTripFor, type PersonStatus } from "@/lib/selectors";
import { VehicleStatus, type ActivityEntry, type User } from "@/lib/types";

const MiniMap = dynamic(() => import("@/components/MiniMap").then((m) => m.MiniMap), {
  ssr: false,
  loading: () => <div className="h-80 animate-pulse rounded-lg bg-slate-100" />,
});

type Filter = "ALL" | "ON_ROAD" | "AWAY" | "ASSIGNED" | "UNASSIGNED" | "DEACTIVATED";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "ALL", label: "Everyone" },
  { id: "ON_ROAD", label: "On the road" },
  { id: "AWAY", label: "Away from vehicle" },
  { id: "ASSIGNED", label: "On a vehicle" },
  { id: "UNASSIGNED", label: "Not on a vehicle" },
  { id: "DEACTIVATED", label: "Deactivated" },
];
const VEHICLE_ORDER: Record<VehicleStatus, number> = { ON_TRIP: 0, AVAILABLE: 1, OUT_OF_SERVICE: 2 };

export default function PeoplePage() {
  return (
    <Suspense>
      <PeopleScreen />
    </Suspense>
  );
}

function PeopleScreen() {
  const me = useUser();
  const allowed = useCan();
  const router = useRouter();
  const params = useSearchParams();
  const param = params.get("id");
  const selectedId = param === "me" ? me.id : param;

  if (!allowed("trackPeople") && selectedId !== me.id) {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <Empty title="Tracking people needs permission">
          Your role can see your own activity and location.{" "}
          <Link href="/people?id=me" className="font-medium text-blue-700 hover:underline">
            Open yours
          </Link>
          . An admin can grant &quot;Track people&quot; on the Admin screen.
        </Empty>
      </div>
    );
  }
  if (selectedId) {
    return (
      <div className="mx-auto max-w-4xl p-4">
        <PersonDetail userId={selectedId} onBack={allowed("trackPeople") ? () => router.push("/people") : undefined} />
      </div>
    );
  }
  return <Overview />;
}

type Row = { user: User; status: PersonStatus };

function Overview() {
  const s = useData();
  const now = useNow(10_000);
  const [filter, setFilter] = useState<Filter>("ALL");

  const rows: Row[] = s.users.map((user) => ({ user, status: personStatus(s, user) }));
  const active = rows.filter((r) => r.user.active);
  const onRoad = (r: Row) => !!r.user.vehicleId && !!roadTripFor(s, r.user.vehicleId);
  const assigned = active.filter((r) => r.user.vehicleId);
  const away = active.filter((r) => r.status.state === "AWAY");
  const unassigned = active.filter((r) => !r.user.vehicleId);
  const lastAction = new Map<string, ActivityEntry>();
  for (const e of s.activity) {
    const prev = lastAction.get(e.userId);
    if (!prev || e.at > prev.at) lastAction.set(e.userId, e);
  }

  const shown = rows
    .filter((r) => {
      if (filter === "DEACTIVATED") return !r.user.active;
      if (!r.user.active) return false;
      if (filter === "ON_ROAD") return onRoad(r);
      if (filter === "AWAY") return r.status.state === "AWAY";
      if (filter === "ASSIGNED") return !!r.user.vehicleId;
      if (filter === "UNASSIGNED") return !r.user.vehicleId;
      return true;
    })
    .sort((a, b) => Number(b.status.state === "AWAY") - Number(a.status.state === "AWAY") || a.user.name.localeCompare(b.user.name));

  const points: MiniMapPoint[] = [
    ...s.vehicles.flatMap((v) => {
      const trip = roadTripFor(s, v.id);
      const at = trip ? lastPing(s, trip.id) : undefined;
      return at ? [{ lat: at.lat, lng: at.lng, color: "#0f172a", label: v.registration, radius: 9 }] : [];
    }),
    ...active.flatMap((r) =>
      r.status.position
        ? [{ lat: r.status.position.lat, lng: r.status.position.lng, color: PERSON_STATE_COLOR[r.status.state], label: r.user.name, radius: r.status.state === "AWAY" ? 8 : 5 }]
        : [],
    ),
  ];
  const vehicles = [...s.vehicles].sort((a, b) => VEHICLE_ORDER[a.status] - VEHICLE_ORDER[b.status] || a.registration.localeCompare(b.registration));

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4">
      <header>
        <h1 className="text-lg font-semibold text-slate-900">People &amp; tracking</h1>
        <p className="text-sm text-slate-500">Who is on which vehicle, where everyone is right now, and everything each person has done.</p>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label="People" value={active.length} />
        <Stat label="On vehicles" value={`${assigned.length} on ${new Set(assigned.map((r) => r.user.vehicleId)).size}`} />
        <Stat label="On the road" value={active.filter(onRoad).length} />
        <Stat label="Away from vehicle" value={away.length} tone={away.length ? "red" : "emerald"} />
        <Stat label="Not on a vehicle" value={unassigned.length} />
      </div>

      {away.length > 0 && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800 ring-1 ring-inset ring-red-200">
          <p className="flex items-center gap-2 font-medium">
            <TriangleAlert className="size-4" aria-hidden /> Away from their vehicle
          </p>
          <ul className="mt-1 space-y-0.5">
            {away.map((r) => (
              <li key={r.user.id}>
                <Link href={`/people?id=${r.user.id}`} className="font-medium underline">
                  {r.user.name}
                </Link>{" "}
                ({r.user.duty ? LABEL.crewRole[r.user.duty].toLowerCase() : "crew"}): {r.status.label}, last seen{" "}
                {timeAgo(r.status.position?.recordedAt, now)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Card title="Where everyone is" subtitle="Each person's latest phone location. Dark dots are vehicles on the road; red is someone away from their vehicle.">
        <MiniMap points={points} frameKey="people" className="h-80 w-full overflow-hidden rounded-lg ring-1 ring-slate-200" />
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
          {(["ON_BOARD", "BADGE_NOT_READ", "AWAY", "AT_FACILITY", "ELSEWHERE"] as const).map((st) => (
            <span key={st} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full" style={{ background: PERSON_STATE_COLOR[st] }} />
              {{ ON_BOARD: "With their vehicle", BADGE_NOT_READ: "Badge not read", AWAY: "Away from vehicle", AT_FACILITY: "At a facility", ELSEWHERE: "Elsewhere" }[st]}
            </span>
          ))}
        </div>
      </Card>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Who is on which vehicle</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {vehicles.map((v) => {
            const members = crewOf(s, v.id);
            const reader = onboard(s, v);
            const detected = reader.crew.filter((c) => c.detected).length;
            return (
              <Card
                key={v.id}
                title={
                  <Link href={`/vehicles?id=${v.id}`} className="hover:underline">
                    {v.registration}
                  </Link>
                }
                subtitle={`${members.length} ${members.length === 1 ? "member" : "members"} · ${v.seats} seats${reader.live ? ` · RFID: ${detected}/${members.length} on board` : ""}`}
                action={<Badge tone={VEHICLE_STATUS_TONE[v.status]}>{LABEL.vehicleStatus[v.status]}</Badge>}
              >
                {members.length === 0 ? (
                  <p className="text-sm text-slate-500">Nobody assigned.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {members.map((m) => {
                      const st = personStatus(s, m);
                      return (
                        <li key={m.id} className="flex items-center gap-2 text-sm">
                          <span className="size-2.5 shrink-0 rounded-full" style={{ background: PERSON_STATE_COLOR[st.state] }} aria-hidden />
                          <Link href={`/people?id=${m.id}`} className="font-medium text-blue-700 hover:underline">
                            {m.name}
                          </Link>
                          <span className="text-xs text-slate-500">{m.duty ? LABEL.crewRole[m.duty] : ""}</span>
                          <span className={cx("ml-auto truncate text-xs", st.state === "AWAY" ? "font-medium text-red-600" : "text-slate-500")}>
                            {st.state === "UNKNOWN" ? "No location" : timeAgo(st.position?.recordedAt, now)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            );
          })}
          <Card title="Not on a vehicle" subtitle={`${unassigned.length} people`}>
            <ul className="space-y-1.5">
              {unassigned.map((r) => (
                <li key={r.user.id} className="flex items-center gap-2 text-sm">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: PERSON_STATE_COLOR[r.status.state] }} aria-hidden />
                  <Link href={`/people?id=${r.user.id}`} className="font-medium text-blue-700 hover:underline">
                    {r.user.name}
                  </Link>
                  <span className="text-xs text-slate-500">{LABEL.role[r.user.role]}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </section>

      <Card title="Everyone" subtitle="Click a name for their map, trips and full activity." flush>
        <div className="flex gap-2 overflow-x-auto border-b border-slate-100 px-4 py-3 [scrollbar-width:none] sm:flex-wrap [&::-webkit-scrollbar]:hidden">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className={chipClass(filter === f.id)} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <div className="p-4">
            <Empty title="Nobody matches this filter" />
          </div>
        ) : (
          <>
          {/* Phones: one line per person instead of a table. */}
          <ul className="divide-y divide-slate-100 sm:hidden">
            {shown.map(({ user: u, status: st }) => {
              const vehicle = find(s.vehicles, u.vehicleId);
              return (
                <li key={u.id} className={cx("flex items-start gap-3 px-4 py-3", !u.active && "opacity-60")}>
                  <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: PERSON_STATE_COLOR[st.state] }} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <Link href={`/people?id=${u.id}`} className="truncate font-medium text-blue-700 hover:underline">
                        {u.name}
                      </Link>
                      <span className="shrink-0 text-xs text-slate-500">{timeAgo(st.position?.recordedAt, now)}</span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {LABEL.role[u.role]}
                      {vehicle && ` · ${vehicle.registration}${u.duty ? ` (${LABEL.crewRole[u.duty].toLowerCase()})` : ""}`}
                    </p>
                    <p className={cx("text-xs", st.state === "AWAY" ? "font-medium text-red-600" : "text-slate-700")}>{st.label}</p>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Person</th>
                  <th className="px-4 py-2 font-medium">Vehicle</th>
                  <th className="px-4 py-2 font-medium">Where now</th>
                  <th className="px-4 py-2 font-medium">Last seen</th>
                  <th className="hidden px-4 py-2 font-medium lg:table-cell">Last action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map(({ user: u, status: st }) => {
                  const vehicle = find(s.vehicles, u.vehicleId);
                  const action = lastAction.get(u.id);
                  return (
                    <tr key={u.id} className={cx(!u.active && "text-slate-400")}>
                      <td className="px-4 py-2">
                        <Link href={`/people?id=${u.id}`} className="font-medium text-blue-700 hover:underline">
                          {u.name}
                        </Link>
                        <div className="text-xs text-slate-500">{LABEL.role[u.role]}</div>
                      </td>
                      <td className="px-4 py-2">
                        {vehicle ? (
                          <>
                            <Link href={`/vehicles?id=${vehicle.id}`} className="whitespace-nowrap text-slate-800 hover:underline">
                              {vehicle.registration}
                            </Link>
                            <div className="text-xs text-slate-500">{u.duty ? LABEL.crewRole[u.duty] : ""}</div>
                          </>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {st.position ? (
                          <Link href={`/map?at=${st.position.lat},${st.position.lng}&label=${encodeURIComponent(u.name)}`} title="Show on the map">
                            <Badge tone={PERSON_STATE_TONE[st.state]}>{st.label}</Badge>
                          </Link>
                        ) : (
                          <Badge>{st.label}</Badge>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-slate-600">{timeAgo(st.position?.recordedAt, now)}</td>
                      <td className="hidden max-w-sm px-4 py-2 lg:table-cell">
                        {action ? (
                          <>
                            <div className="truncate text-slate-700" title={action.summary}>
                              {action.summary}
                            </div>
                            <div className="text-xs text-slate-500">{timeAgo(action.at, now)}</div>
                          </>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>

      <ActivityLog />
    </div>
  );
}

/** The latest things anyone did, across everyone. */
function ActivityLog() {
  const s = useData();
  const [limit, setLimit] = useState(25);
  const entries = [...s.activity].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <Card title="Activity log" subtitle={`${entries.length} actions recorded. Newest first.`} flush>
      <ol className="divide-y divide-slate-100">
        {entries.slice(0, limit).map((e) => {
          const who = find(s.users, e.userId);
          return (
            <li key={e.id} className="flex items-start gap-3 px-4 py-2 text-sm">
              <span className="w-12 shrink-0 pt-0.5 text-xs tabular-nums text-slate-500" title={e.at}>
                {sastTime(e.at)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-slate-800">
                  <Link href={`/people?id=${e.userId}`} className="font-medium text-blue-700 hover:underline">
                    {who?.name ?? "Unknown"}
                  </Link>{" "}
                  · {e.summary}
                </p>
                <p className="text-xs text-slate-500">
                  {LABEL.activity[e.kind]} · {timeAgo(e.at)}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      {entries.length > limit && (
        <div className="border-t border-slate-100 p-3 text-center">
          <button type="button" className="text-sm font-medium text-blue-700 hover:underline" onClick={() => setLimit((n) => n + 50)}>
            Show more
          </button>
        </div>
      )}
    </Card>
  );
}
