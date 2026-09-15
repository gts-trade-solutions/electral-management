"use client";

import Link from "next/link";
import { formatKm, LABEL, sastDateTime, sastStamp } from "@/lib/format";
import { kmBetween } from "@/lib/rules";
import { eventFacility, find, loadSeal } from "@/lib/selectors";
import { CustodyEventType, GpsSource, type CustodyEvent, type DemoState } from "@/lib/types";
import { Badge, CUSTODY_TONE, cx } from "./ui";

const DOT: Record<CustodyEventType, string> = {
  INTAKE: "bg-slate-500",
  LOAD: "bg-blue-600",
  RECEIVE: "bg-emerald-600",
  REPORT_MISSING: "bg-red-600",
};

/** Every hand-off for one asset: who held it, where, and on which vehicle. */
export function CustodyTimeline({ state, events }: { state: DemoState; events: readonly CustodyEvent[] }) {
  if (!events.length) return <p className="text-sm text-slate-500">No custody records yet.</p>;
  return (
    <ol className="relative ml-1.5 space-y-5 border-l-2 border-slate-200 pl-5">
      {events.map((e, i) => (
        <TimelineItem key={e.id} state={state} event={e} step={i + 1} latest={i === events.length - 1} />
      ))}
    </ol>
  );
}

function TimelineItem({ state: s, event: e, step, latest }: { state: DemoState; event: CustodyEvent; step: number; latest: boolean }) {
  const trip = find(s.trips, e.tripId);
  const vehicle = trip ? find(s.vehicles, trip.vehicleId) : undefined;
  const destination = trip ? find(s.facilities, trip.destFacilityId) : undefined;
  const from = find(s.facilities, e.fromFacilityId);
  const to = find(s.facilities, e.toFacilityId);
  const place = eventFacility(s, e);
  const kmFromPlace = place ? kmBetween(e, place) : null;
  const sealAtLoad = e.type === CustodyEventType.RECEIVE && e.tripId ? loadSeal(s, e.assetId, e.tripId) : null;

  const what: Record<CustodyEventType, string> = {
    INTAKE: `Taken into stock at ${to?.name}`,
    LOAD: `Released from ${from?.name} onto ${vehicle?.registration}, bound for ${destination?.name}`,
    RECEIVE: `Received at ${to?.name} off ${vehicle?.registration}`,
    REPORT_MISSING: from
      ? `Reported missing. Last held at ${from.name}`
      : vehicle
        ? `Reported missing from ${vehicle.registration}`
        : "Reported missing",
  };
  const heldBy =
    e.type === CustodyEventType.LOAD
      ? `${e.custodian ?? "The crew"}, driver of ${vehicle?.registration}`
      : e.type === CustodyEventType.REPORT_MISSING
        ? "Nobody: location unknown"
        : `${e.custodian ?? e.officerName} at ${to?.name}`;
  const mapHref = `/map?at=${e.lat},${e.lng}&label=${encodeURIComponent(`${step}. ${LABEL.custody[e.type]}`)}`;

  return (
    <li className="relative">
      <span className={cx("absolute -left-[27px] top-1 size-3 rounded-full ring-4 ring-white", DOT[e.type])} aria-hidden />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-400">{step}</span>
        <Badge tone={CUSTODY_TONE[e.type]}>{LABEL.custody[e.type]}</Badge>
        <time className="text-xs text-slate-500" dateTime={e.createdAt} title={sastStamp(e.createdAt)}>
          {sastDateTime(e.createdAt)} SAST
        </time>
        {latest && <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">latest</span>}
      </div>
      <p className="mt-1 text-sm text-slate-800">{what[e.type]}</p>
      <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-slate-400">Recorded by</dt>
        <dd className="text-slate-700">
          {e.officerId ? (
            <Link href={`/people?id=${e.officerId}`} className="text-blue-700 hover:underline">
              {e.officerName}
            </Link>
          ) : (
            e.officerName
          )}
        </dd>
        <dt className="text-slate-400">Held by</dt>
        <dd className="text-slate-700">{heldBy}</dd>
        {e.sealNumber && (
          <>
            <dt className="text-slate-400">Seal</dt>
            <dd className="font-mono text-slate-700">
              {e.sealNumber}
              {sealAtLoad !== null && sealAtLoad !== e.sealNumber && (
                <span className="ml-2 font-sans font-medium text-red-600">loaded as {sealAtLoad}</span>
              )}
            </dd>
          </>
        )}
        <dt className="text-slate-400">Scanned at</dt>
        <dd>
          <Link href={mapHref} className="font-mono text-blue-700 hover:underline" title="Show on the map">
            {e.lat.toFixed(5)}, {e.lng.toFixed(5)}
          </Link>
          {e.gpsAccuracyM !== null && <span className="text-slate-500"> ±{e.gpsAccuracyM} m</span>}
        </dd>
      </dl>
      {e.gpsSource === GpsSource.FACILITY_FALLBACK ? (
        <p className="mt-1 text-xs font-medium text-amber-700">No GPS fix on the device: the facility&apos;s location was recorded instead.</p>
      ) : place && kmFromPlace !== null && kmFromPlace > 1 ? (
        <p className="mt-1 text-xs font-medium text-amber-700">
          Scanned {formatKm(kmFromPlace)} away from {place.name}.
        </p>
      ) : null}
    </li>
  );
}
