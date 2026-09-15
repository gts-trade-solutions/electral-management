"use client";

import { useState, type FormEvent } from "react";
import { createVehicle, updateVehicle } from "@/lib/domain";
import { execute, useUser } from "@/lib/hooks";
import { VehicleStatus, type Vehicle } from "@/lib/types";
import { formatTag, randomEpc } from "@/lib/validate";
import { Button, Card, cx, Field, inputClass } from "../ui";

/** Add a vehicle, or edit one: plate, windscreen RFID tag, in-cab reader, seats and service status. */
export function VehicleForm({ vehicle, onDone, onCancel }: { vehicle?: Vehicle; onDone: (vehicleId: string) => void; onCancel: () => void }) {
  const user = useUser();
  const [registration, setRegistration] = useState(vehicle?.registration ?? "");
  const [rfidTag, setRfidTag] = useState(vehicle ? formatTag(vehicle.rfidTag) : "");
  const [readerId, setReaderId] = useState(vehicle?.readerId ?? "");
  const [seats, setSeats] = useState(String(vehicle?.seats ?? 3));
  const [outOfService, setOutOfService] = useState(vehicle?.status === VehicleStatus.OUT_OF_SERVICE);
  const suggestedReader = `RDR-${registration.toUpperCase().replace(/[^A-Z0-9]/g, "")}`;
  const onTrip = vehicle?.status === VehicleStatus.ON_TRIP;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const input = { registration, rfidTag, readerId: readerId.trim() || suggestedReader, seats: Number(seats) };
    if (vehicle) {
      if (execute((st) => updateVehicle(st, user, vehicle.id, { ...input, outOfService }), "Vehicle saved.")) onDone(vehicle.id);
    } else {
      const result = execute((st) => createVehicle(st, user, input), (r) => `${r.vehicle.registration} added.`);
      if (result) onDone(result.vehicle.id);
    }
  };

  return (
    <Card
      title={vehicle ? `Edit ${vehicle.registration}` : "Add a vehicle"}
      subtitle="The number plate, the RFID tag on the windscreen, and the in-cab reader that counts crew badges and asset tags."
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Registration" hint="South African plate, e.g. JK 21 LM GP or CA 123-456">
            <input
              className={cx(inputClass, "uppercase")}
              value={registration}
              onChange={(e) => setRegistration(e.target.value)}
              placeholder="JK 21 LM GP"
              autoComplete="off"
              required
            />
          </Field>
          <Field label="Seats" hint="Crew can't exceed this">
            <input className={inputClass} type="number" min={1} max={60} value={seats} onChange={(e) => setSeats(e.target.value)} required />
          </Field>
          <Field label="Windscreen RFID tag" hint="96-bit EPC: 24 hex characters">
            <div className="flex gap-2">
              <input
                className={cx(inputClass, "min-w-0 font-mono uppercase")}
                value={rfidTag}
                onChange={(e) => setRfidTag(e.target.value)}
                placeholder="E280 1170 …"
                autoComplete="off"
                spellCheck={false}
                required
              />
              <Button variant="secondary" className="shrink-0" onClick={() => setRfidTag(formatTag(randomEpc("E2801170")))}>
                Generate
              </Button>
            </div>
          </Field>
          <Field label="In-cab reader ID">
            <input
              className={cx(inputClass, "font-mono uppercase")}
              value={readerId}
              onChange={(e) => setReaderId(e.target.value)}
              placeholder={suggestedReader}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
        </div>
        {vehicle && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="size-4 accent-slate-900"
              checked={outOfService}
              disabled={onTrip}
              onChange={(e) => setOutOfService(e.target.checked)}
            />
            Out of service{onTrip ? " (not while it's on a trip)" : ""}
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit">{vehicle ? "Save" : "Add vehicle"}</Button>
        </div>
      </form>
    </Card>
  );
}
