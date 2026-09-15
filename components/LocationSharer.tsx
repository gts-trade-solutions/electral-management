"use client";

import { MapPin, MapPinOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { APP_NAME, STORAGE_PREFIX } from "@/lib/brand";
import { recordUserPing } from "@/lib/domain";
import { describeGeoError } from "@/lib/gps";
import { kmBetween } from "@/lib/rules";
import { run } from "@/lib/store";
import { toast } from "@/lib/toast";
import { PingSource, Role, type Fix, type User } from "@/lib/types";
import { cx } from "./ui";

/** Report at least this often, even standing still, so a person left behind is still compared with their moving vehicle. */
const HEARTBEAT_MS = 30_000;
/** ...and straight away once they've moved this far. */
const MOVED_KM = 0.02;

const prefKey = (userId: string) => `${STORAGE_PREFIX}:share-location:${userId}`;

/** People in the field share their location by default; office staff choose to. */
export function sharesByDefault(user: User): boolean {
  return !!user.vehicleId || user.role === Role.OFFICER || user.role === Role.CREW;
}

function readPreference(user: User): boolean {
  try {
    const saved = window.localStorage.getItem(prefKey(user.id));
    return saved === null ? sharesByDefault(user) : saved === "1";
  } catch {
    return sharesByDefault(user);
  }
}

/**
 * Shares the signed-in person's location from this device while the app is
 * open: on every move of 20 m or more, and every 30 s regardless. Each report
 * goes through recordUserPing(), which raises CREW_AWAY_FROM_VEHICLE.
 */
export function LocationSharer({ user }: { user: User }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const last = useRef<{ fix: Fix; at: number } | null>(null);

  useEffect(() => {
    setOn(readPreference(user));
  }, [user]);

  useEffect(() => {
    if (!on) {
      setSharing(false);
      return;
    }
    if (!("geolocation" in navigator)) {
      setError("This browser can't share its location.");
      return;
    }
    const report = (p: GeolocationPosition, heartbeat: boolean) => {
      const fix = { lat: p.coords.latitude, lng: p.coords.longitude };
      const now = Date.now();
      const prev = last.current;
      if (!heartbeat && prev && now - prev.at < HEARTBEAT_MS && kmBetween(prev.fix, fix) < MOVED_KM) return;
      last.current = { fix, at: now };
      try {
        run((s) => recordUserPing(s, user.id, { ...fix, accuracyM: Math.round(p.coords.accuracy) }, new Date(now), PingSource.PHONE));
        setSharing(true);
        setError(null);
      } catch {
        setSharing(false);
      }
    };
    const onError = (err: GeolocationPositionError) => {
      setSharing(false);
      setError(describeGeoError(err));
    };
    const watch = navigator.geolocation.watchPosition((p) => report(p, false), onError, {
      enableHighAccuracy: true,
      maximumAge: 10_000,
      timeout: 30_000,
    });
    const beat = setInterval(() => {
      navigator.geolocation.getCurrentPosition((p) => report(p, true), onError, { maximumAge: HEARTBEAT_MS, timeout: 20_000 });
    }, HEARTBEAT_MS);
    return () => {
      navigator.geolocation.clearWatch(watch);
      clearInterval(beat);
    };
  }, [on, user.id]);

  if (on === null) return null;

  const toggle = () => {
    const next = !on;
    try {
      window.localStorage.setItem(prefKey(user.id), next ? "1" : "0");
    } catch {
      // No storage: the choice lasts until the page closes.
    }
    setOn(next);
    toast.info(next ? `Sharing your location while ${APP_NAME} is open.` : "Location sharing is off on this device.");
  };

  const label = !on ? "Location off" : error ? "Location unavailable" : sharing ? "Sharing location" : "Finding location…";
  const title = !on
    ? "Your location isn't being shared. Click to share it while the app is open."
    : (error ?? `Your coordinators can see where you are while ${APP_NAME} is open. Click to stop.`);
  return (
    <button
      type="button"
      onClick={toggle}
      title={title}
      className={cx(
        "flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs",
        !on ? "bg-white/10 text-slate-300 hover:bg-white/15" : error ? "bg-amber-500/20 text-amber-100" : "bg-emerald-500/20 text-emerald-100",
      )}
    >
      {on ? <MapPin className="size-3.5" aria-hidden /> : <MapPinOff className="size-3.5" aria-hidden />}
      <span className="hidden 2xl:inline">{label}</span>
      {on && sharing && !error && <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" aria-hidden />}
    </button>
  );
}
