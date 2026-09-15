"use client";

import { LocateFixed, TriangleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";
import { facilityFix, useGpsWatch } from "@/lib/gps";
import type { Facility, GpsFix } from "@/lib/types";

/**
 * The GPS fix a hand-off will record, plus a status line for the form.
 * Without a device fix the user may record the facility's location instead;
 * the custody record is flagged FACILITY_FALLBACK so nobody mistakes it for GPS.
 */
export function useHandoffGps(fallback: Facility | null): { fix: GpsFix | null; status: ReactNode } {
  const { fix, error } = useGpsWatch();
  const [useFallback, setUseFallback] = useState(false);

  if (useFallback && fallback) {
    return {
      fix: facilityFix(fallback),
      status: (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">
          <p className="flex items-center gap-2">
            <TriangleAlert className="size-4 shrink-0" aria-hidden />
            Recording {fallback.name}&apos;s location, flagged as not GPS.
          </p>
          <button type="button" className="mt-1 font-medium underline" onClick={() => setUseFallback(false)}>
            Use device GPS instead
          </button>
        </div>
      ),
    };
  }

  if (fix) {
    return {
      fix,
      status: (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 ring-1 ring-inset ring-emerald-200">
          <LocateFixed className="size-4 shrink-0" aria-hidden />
          <span>
            GPS fix ±{fix.accuracyM} m · <span className="font-mono">{fix.lat.toFixed(5)}, {fix.lng.toFixed(5)}</span>
          </span>
        </div>
      ),
    };
  }

  return {
    fix: null,
    status: (
      <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">
        <p className="flex items-center gap-2">
          <TriangleAlert className="size-4 shrink-0" aria-hidden />
          {error ?? "Waiting for a GPS fix. Allow location access if the browser asks."}
        </p>
        {fallback && (
          <button type="button" className="mt-1 font-medium underline" onClick={() => setUseFallback(true)}>
            No GPS? Record {fallback.name}&apos;s location instead (flagged)
          </button>
        )}
      </div>
    ),
  };
}
