"use client";

import { LoaderCircle, Route } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { createTrip } from "@/lib/domain";
import { formatKm } from "@/lib/format";
import { execute, useData, useUser } from "@/lib/hooks";
import { planRoute, type PlannedRoute } from "@/lib/routing";
import { driverOf, find, openTripFor } from "@/lib/selectors";
import { FacilityType, VehicleStatus, type Facility, type Vehicle } from "@/lib/types";
import { Button, Card, Field, inputClass } from "../ui";

export function NewTripForm({ onCreated, onCancel }: { onCreated: (tripId: string) => void; onCancel: () => void }) {
  const s = useData();
  const user = useUser();
  // Facilities never change; the state object itself is replaced on every GPS ping.
  const facilities = useRef(s.facilities);
  const warehouses = s.facilities.filter((f) => f.type === FacilityType.WAREHOUSE);
  const stations = s.facilities.filter((f) => f.type === FacilityType.VOTING_STATION);

  const [originId, setOriginId] = useState(warehouses[0]?.id ?? "");
  const [destId, setDestId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [route, setRoute] = useState<PlannedRoute | null>(null);
  const [planning, setPlanning] = useState(false);

  const unavailable = (v: Vehicle) =>
    v.status === VehicleStatus.OUT_OF_SERVICE ? "out of service" : openTripFor(s, v.id) ? "on an open trip" : null;
  const chosenVehicle = vehicleId || s.vehicles.find((v) => !unavailable(v))?.id || "";

  useEffect(() => {
    const origin = find(facilities.current, originId);
    const destination = find(facilities.current, destId);
    setRoute(null);
    if (!origin || !destination || origin.id === destination.id) return;
    let cancelled = false;
    setPlanning(true);
    planRoute(origin, destination).then((planned) => {
      if (cancelled) return;
      setRoute(planned);
      setPlanning(false);
    });
    return () => {
      cancelled = true;
      setPlanning(false);
    };
  }, [originId, destId]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!route) return;
    const result = execute(
      (st) =>
        createTrip(st, user, { originFacilityId: originId, destFacilityId: destId, vehicleId: chosenVehicle, plannedRoute: route.route }, new Date()),
      "Trip created. Pick the assets it will carry.",
    );
    if (result) onCreated(result.trip.id);
  };

  const options = (list: Facility[]) =>
    list.map((f) => (
      <option key={f.id} value={f.id}>
        {f.name}
      </option>
    ));

  return (
    <Card title="New trip" subtitle="Where from, where to, and which vehicle. The route is planned on real roads.">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="From">
            <select className={inputClass} value={originId} onChange={(e) => setOriginId(e.target.value)}>
              <optgroup label="Warehouses">{options(warehouses)}</optgroup>
              <optgroup label="Voting stations (return leg)">{options(stations)}</optgroup>
            </select>
          </Field>
          <Field label="To">
            <select className={inputClass} value={destId} onChange={(e) => setDestId(e.target.value)} required>
              <option value="" disabled>
                Choose a destination
              </option>
              <optgroup label="Voting stations">{options(stations.filter((f) => f.id !== originId))}</optgroup>
              <optgroup label="Warehouses">{options(warehouses.filter((f) => f.id !== originId))}</optgroup>
            </select>
          </Field>
        </div>

        <Field label="Vehicle" hint="Vehicles on an open trip, or out of service, can't be assigned. Manage crew on the Vehicles screen.">
          <select className={inputClass} value={chosenVehicle} onChange={(e) => setVehicleId(e.target.value)}>
            {!chosenVehicle && (
              <option value="" disabled>
                No vehicle is free
              </option>
            )}
            {s.vehicles.map((v) => {
              const why = unavailable(v);
              return (
                <option key={v.id} value={v.id} disabled={!!why}>
                  {v.registration} · {driverOf(s, v.id)?.name ?? "no driver"}
                  {why ? ` (${why})` : ""}
                </option>
              );
            })}
          </select>
        </Field>

        <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 ring-1 ring-inset ring-slate-200">
          {planning ? (
            <>
              <LoaderCircle className="size-4 animate-spin" aria-hidden /> Planning the route…
            </>
          ) : route ? (
            <>
              <Route className="size-4" aria-hidden />
              {route.source === "ROAD"
                ? `Road route, ${formatKm(route.km)}`
                : `Straight line, ${formatKm(route.km)}. The routing service couldn't be reached.`}
            </>
          ) : (
            "Choose a destination to plan the route."
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={!route || planning || !chosenVehicle}>
            Create trip
          </Button>
        </div>
      </form>
    </Card>
  );
}
