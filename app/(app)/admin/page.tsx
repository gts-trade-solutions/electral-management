"use client";

import { Check, UserPlus } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Badge, Button, Card, cx, Empty, Field, inputClass, PERSON_STATE_TONE } from "@/components/ui";
import { createUser, setRolePermission, setUserActive, setUserRole, updateSettings } from "@/lib/domain";
import { LABEL, timeAgo } from "@/lib/format";
import { execute, useCan, useData, useNow, useUser } from "@/lib/hooks";
import { PERMISSION_LABEL } from "@/lib/permissions";
import { crewOf, find, personStatus } from "@/lib/selectors";
import { CrewRole, PERMISSIONS, Role, type ConfigurableRole } from "@/lib/types";
import { ROLE_SUMMARY } from "@/lib/users";
import { formatTag, randomEpc } from "@/lib/validate";

const CONFIGURABLE: ConfigurableRole[] = [Role.COORDINATOR, Role.OFFICER, Role.CREW];

export default function AdminPage() {
  const allowed = useCan();
  if (!allowed("manageUsers")) {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <Empty title="Admins only">Sign in as an admin to manage users, roles and alert settings.</Empty>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <header>
        <h1 className="text-lg font-semibold text-slate-900">Admin</h1>
        <p className="text-sm text-slate-500">
          Accounts and which vehicle each person is on, what each role may do, and how the unusual-activity alerts decide. Where everyone is and
          what they&apos;ve done is under{" "}
          <Link href="/people" className="font-medium text-blue-700 hover:underline">
            People
          </Link>
          .
        </p>
      </header>
      <UsersCard />
      <PermissionsCard />
      <SettingsCard />
    </div>
  );
}

function UsersCard() {
  const s = useData();
  const me = useUser();
  const now = useNow(15_000);
  const [adding, setAdding] = useState(false);
  const active = s.users.filter((u) => u.active);

  return (
    <Card
      title="Users"
      subtitle={`${active.length} active of ${s.users.length} accounts, ${active.filter((u) => u.vehicleId).length} of them on vehicles. Records keep the names of whoever made them, so accounts are deactivated rather than deleted.`}
      action={
        <Button size="sm" onClick={() => setAdding((a) => !a)}>
          <UserPlus className="size-4" aria-hidden /> Add user
        </Button>
      }
      flush
    >
      {adding && (
        <div className="border-b border-slate-100 p-4">
          <AddUserForm onDone={() => setAdding(false)} />
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="hidden px-4 py-2 font-medium md:table-cell">Email</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium">Vehicle</th>
              <th className="hidden px-4 py-2 font-medium lg:table-cell">Where now</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {s.users.map((u) => {
              const isMe = u.id === me.id;
              const vehicle = find(s.vehicles, u.vehicleId);
              const status = personStatus(s, u);
              return (
                <tr key={u.id} className={cx(!u.active && "text-slate-400")}>
                  <td className="px-4 py-2">
                    <Link href={`/people?id=${u.id}`} className="font-medium text-blue-700 hover:underline">
                      {u.name}
                    </Link>
                    {isMe && <span className="ml-2 text-xs text-slate-500">(you)</span>}
                    <div className="text-xs text-slate-500 md:hidden">{u.email}</div>
                  </td>
                  <td className="hidden px-4 py-2 md:table-cell">{u.email}</td>
                  <td className="px-4 py-2">
                    <select
                      className={cx(inputClass, "w-auto min-w-36 py-1")}
                      value={u.role}
                      disabled={!u.active}
                      aria-label={`Role for ${u.name}`}
                      onChange={(e) => {
                        const role = e.target.value as Role;
                        execute((st) => setUserRole(st, me, u.id, role, new Date()), `${u.name} is now ${LABEL.role[role].toLowerCase()}.`);
                      }}
                    >
                      {Object.values(Role).map((r) => (
                        <option key={r} value={r}>
                          {LABEL.role[r]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2">
                    {vehicle ? (
                      <>
                        <Link href={`/vehicles?id=${vehicle.id}`} className="whitespace-nowrap hover:underline">
                          {vehicle.registration}
                        </Link>
                        <div className="text-xs text-slate-500">{u.duty ? LABEL.crewRole[u.duty] : ""}</div>
                      </>
                    ) : (
                      <Link href={`/people?id=${u.id}`} className="text-xs text-slate-400 hover:text-blue-700 hover:underline">
                        {u.active ? "Assign…" : "—"}
                      </Link>
                    )}
                  </td>
                  <td className="hidden px-4 py-2 lg:table-cell">
                    {status.position ? (
                      <>
                        <Badge tone={PERSON_STATE_TONE[status.state]}>{status.label}</Badge>
                        <div className="mt-0.5 text-xs text-slate-500">seen {timeAgo(status.position.recordedAt, now)}</div>
                      </>
                    ) : (
                      <span className="text-xs text-slate-400">No location yet</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <Badge tone={u.active ? "emerald" : "slate"}>{u.active ? "Active" : "Deactivated"}</Badge>
                  </td>
                  <td className="px-4 py-2 text-right">
                    {!isMe && (
                      <Button
                        size="sm"
                        variant={u.active ? "ghost" : "secondary"}
                        onClick={() =>
                          execute(
                            (st) => setUserActive(st, me, u.id, !u.active, new Date()),
                            `${u.name} ${u.active ? "deactivated" : "reactivated"}.`,
                          )
                        }
                      >
                        {u.active ? "Deactivate" : "Reactivate"}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function AddUserForm({ onDone }: { onDone: () => void }) {
  const s = useData();
  const me = useUser();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>(Role.OFFICER);
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [badge, setBadge] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [duty, setDuty] = useState<CrewRole>(CrewRole.ESCORT);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = execute(
      (st) =>
        createUser(
          st,
          me,
          { name, email, role, password, phone, rfidBadge: badge, vehicleId: vehicleId || null, duty: vehicleId ? duty : null },
          new Date(),
        ),
      (r) => {
        const on = find(r.state.vehicles, r.user.vehicleId);
        return `${r.user.name} can now sign in as ${LABEL.role[r.user.role].toLowerCase()}${on ? `, on ${on.registration} as ${LABEL.crewRole[duty].toLowerCase()}` : ""}.`;
      },
    );
    if (result) onDone();
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Full name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Email">
          <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" />
        </Field>
        <Field label="Role" hint={ROLE_SUMMARY[role]}>
          <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {Object.values(Role).map((r) => (
              <option key={r} value={r}>
                {LABEL.role[r]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Password" hint="At least 8 characters. Demo only: stored in this browser.">
          <input className={inputClass} type="text" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="off" />
        </Field>
        <Field label="Mobile number" hint="Optional">
          <input className={inputClass} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="082 123 4567" />
        </Field>
        <Field label="RFID badge" hint="Optional. Vehicle readers count badges on board.">
          <div className="flex gap-2">
            <input className={cx(inputClass, "min-w-0 font-mono uppercase")} value={badge} onChange={(e) => setBadge(e.target.value)} spellCheck={false} />
            <Button variant="secondary" className="shrink-0" onClick={() => setBadge(formatTag(randomEpc("E2003412")))}>
              New
            </Button>
          </div>
        </Field>
        <Field label="Vehicle" hint="Optional. Who is on which vehicle can change later.">
          <select className={inputClass} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            <option value="">Not on a vehicle</option>
            {s.vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.registration} · {crewOf(s, v.id).length}/{v.seats} seats
              </option>
            ))}
          </select>
        </Field>
        {vehicleId && (
          <Field label="Duty on the vehicle">
            <select className={inputClass} value={duty} onChange={(e) => setDuty(e.target.value as CrewRole)}>
              {Object.values(CrewRole).map((r) => (
                <option key={r} value={r}>
                  {LABEL.crewRole[r]}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit">Add user</Button>
      </div>
    </form>
  );
}

function PermissionsCard() {
  const s = useData();
  const me = useUser();
  return (
    <Card title="Role permissions" subtitle="Tick what each role may do. Changes apply immediately, including to people already signed in." flush>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Permission</th>
              <th className="px-4 py-2 font-medium">Admin</th>
              {CONFIGURABLE.map((r) => (
                <th key={r} className="px-4 py-2 font-medium">
                  {LABEL.role[r]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {PERMISSIONS.map((p) => (
              <tr key={p}>
                <td className="px-4 py-2 text-slate-800">{PERMISSION_LABEL[p]}</td>
                <td className="px-4 py-2">
                  <Check className="mx-auto size-4 text-emerald-600" aria-label="Always" />
                </td>
                {CONFIGURABLE.map((r) => (
                  <td key={r} className="px-4 py-2 text-center">
                    <input
                      type="checkbox"
                      className="size-4 accent-slate-900"
                      checked={s.rolePermissions[r].includes(p)}
                      aria-label={`${LABEL.role[r]}: ${PERMISSION_LABEL[p]}`}
                      onChange={(e) => {
                        const allowed = e.target.checked;
                        execute(
                          (st) => setRolePermission(st, me, r, p, allowed, new Date()),
                          `${LABEL.role[r]}s ${allowed ? "can now" : "can no longer"} ${PERMISSION_LABEL[p].toLowerCase()}.`,
                        );
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td className="px-4 py-2 text-slate-800">Manage users, roles and alert settings</td>
              <td className="px-4 py-2">
                <Check className="mx-auto size-4 text-emerald-600" aria-label="Always" />
              </td>
              <td colSpan={CONFIGURABLE.length} className="px-4 py-2 text-center text-xs text-slate-400">
                Admins only, so nobody can lock the admins out
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
        Everyone can always see their own activity and location, and shares their location while signed in (field staff by default).
      </p>
    </Card>
  );
}

function SettingsCard() {
  const s = useData();
  const me = useUser();
  const [minutes, setMinutes] = useState(String(s.settings.stopAlertMinutes));
  const [metres, setMetres] = useState(String(s.settings.crewAwayMetres));

  const save = (e: FormEvent) => {
    e.preventDefault();
    execute(
      (st) => updateSettings(st, me, { stopAlertMinutes: Number(minutes), crewAwayMetres: Number(metres) }, new Date()),
      `Alert rules saved: unscheduled stop after ${minutes} min, crew away beyond ${metres} m.`,
    );
  };

  return (
    <Card title="Alert rules" subtitle="How the system decides something unusual is happening on the road.">
      <form onSubmit={save} className="flex flex-wrap items-end gap-3">
        <div className="w-48">
          <Field label="Unscheduled stop after (min)">
            <input
              className={inputClass}
              type="number"
              step="0.5"
              min={0.5}
              max={120}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              aria-label="Unscheduled stop alert, in minutes"
            />
          </Field>
        </div>
        <div className="w-48">
          <Field label="Crew away beyond (m)">
            <input
              className={inputClass}
              type="number"
              step="10"
              min={20}
              max={5000}
              value={metres}
              onChange={(e) => setMetres(e.target.value)}
              aria-label="Crew away from vehicle alert, in metres"
            />
          </Field>
        </div>
        <Button type="submit">Save</Button>
      </form>
      <ul className="mt-4 space-y-2 text-sm text-slate-600">
        <li>
          <strong className="text-slate-800">Unscheduled stop:</strong> a vehicle stands still more than 300 m from its origin and destination
          for longer than the limit above. Use 0.5 minutes for a quick demo.
        </li>
        <li>
          <strong className="text-slate-800">Route deviation:</strong> more than 2 km from the planned route. This limit is fixed.
        </li>
        <li>
          <strong className="text-slate-800">Crew left vehicle:</strong> the in-cab RFID reader stops seeing a crew member&apos;s badge away from
          the origin and destination.
        </li>
        <li>
          <strong className="text-slate-800">Crew away from vehicle:</strong> a crew member&apos;s phone is further from their vehicle than the
          distance above while it&apos;s on the road. At the origin or destination they may move around within 300 m. Raised once each time they
          go beyond it.
        </li>
        <li>
          <strong className="text-slate-800">Asset not detected:</strong> the reader stops seeing a loaded asset&apos;s tag while in transit.
        </li>
        <li>
          <strong className="text-slate-800">Manifest mismatch:</strong> someone tries to close a trip whose loaded and received assets don&apos;t
          match. Closure is blocked.
        </li>
      </ul>
    </Card>
  );
}
