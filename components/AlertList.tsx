"use client";

import { CircleCheck, MapPin, Truck, UserRound } from "lucide-react";
import Link from "next/link";
import { acknowledgeAlert } from "@/lib/domain";
import { LABEL, sastDateTime, timeAgo } from "@/lib/format";
import { execute, useCan, useData, useNow, useUser } from "@/lib/hooks";
import { find, tripParts } from "@/lib/selectors";
import type { Alert, AlertType } from "@/lib/types";
import { ALERT_TONE, Badge, Button, cx, Empty } from "./ui";

const RING: Record<AlertType, string> = {
  MANIFEST_MISMATCH: "ring-red-200",
  ROUTE_DEVIATION: "ring-orange-200",
  UNSCHEDULED_STOP: "ring-amber-200",
  CREW_LEFT_VEHICLE: "ring-red-200",
  CREW_AWAY_FROM_VEHICLE: "ring-red-200",
  ASSET_NOT_DETECTED: "ring-red-200",
};

/** Where "Map" should take you for an alert: the spot it happened, or its trip. */
export function alertMapHref(alert: Alert): string {
  return alert.lat !== null && alert.lng !== null
    ? `/map?at=${alert.lat},${alert.lng}&label=${encodeURIComponent(LABEL.alertType[alert.type])}`
    : `/map?trip=${alert.tripId}`;
}

export function AlertList({
  alerts,
  onShowOnMap,
  emptyText = "No open alerts.",
}: {
  alerts: Alert[];
  /** On the map screen, frame the alert instead of navigating to the map. */
  onShowOnMap?: (alert: Alert) => void;
  emptyText?: string;
}) {
  const s = useData();
  const user = useUser();
  const allowed = useCan();
  const now = useNow(15_000);

  if (!alerts.length) return <Empty title={emptyText} />;

  return (
    <ul className="space-y-2">
      {alerts.map((a) => {
        const trip = find(s.trips, a.tripId);
        const parts = trip ? tripParts(s, trip) : null;
        const person = find(s.users, a.userId);
        const fresh = !a.acknowledged && now - Date.parse(a.createdAt) < 90_000;
        return (
          <li
            key={a.id}
            className={cx("rounded-lg bg-white p-3 ring-1", a.acknowledged ? "ring-slate-200" : RING[a.type], fresh && "shadow-md ring-2 ring-red-400")}
          >
            <div className="flex items-center justify-between gap-2">
              <Badge tone={a.acknowledged ? "slate" : ALERT_TONE[a.type]}>{LABEL.alertType[a.type]}</Badge>
              <time className="text-xs text-slate-500" dateTime={a.createdAt} title={sastDateTime(a.createdAt)}>
                {fresh ? "new · " : ""}
                {timeAgo(a.createdAt, now)}
              </time>
            </div>
            <p className="mt-2 text-sm text-slate-800">{a.message}</p>
            {parts && (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                <Truck className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">
                  {parts.vehicle.registration} · {parts.origin.name} → {parts.destination.name}
                </span>
              </p>
            )}
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
              {a.acknowledged ? (
                <span className="flex items-center gap-1 text-xs text-slate-500">
                  <CircleCheck className="size-3.5 text-emerald-600" aria-hidden />
                  Acknowledged by {a.acknowledgedBy}, {sastDateTime(a.acknowledgedAt)}
                </span>
              ) : allowed("acknowledgeAlert") ? (
                <Button size="sm" onClick={() => execute((st) => acknowledgeAlert(st, user, a.id, new Date()), "Alert acknowledged.")}>
                  Acknowledge
                </Button>
              ) : (
                <span className="text-xs text-slate-500">Awaiting a coordinator</span>
              )}
              {onShowOnMap ? (
                <button type="button" onClick={() => onShowOnMap(a)} className="flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline">
                  <MapPin className="size-3.5" aria-hidden /> Show on map
                </button>
              ) : (
                <Link href={alertMapHref(a)} className="flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline">
                  <MapPin className="size-3.5" aria-hidden /> Map
                </Link>
              )}
              <Link href={`/trips?id=${a.tripId}`} className="text-xs font-medium text-blue-700 hover:underline">
                Trip
              </Link>
              {parts && (
                <Link href={`/vehicles?id=${parts.vehicle.id}`} className="text-xs font-medium text-blue-700 hover:underline">
                  Vehicle
                </Link>
              )}
              {person && (
                <Link href={`/people?id=${person.id}`} className="flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline">
                  <UserRound className="size-3.5" aria-hidden /> {person.name}
                </Link>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
