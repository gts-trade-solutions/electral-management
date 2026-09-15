import { useEffect, useState } from "react";
import { GpsSource, type Facility, type GpsFix } from "./types";

export function describeGeoError(err: GeolocationPositionError): string {
  if (err.code === err.PERMISSION_DENIED) {
    return window.isSecureContext ? "Location is blocked for this site." : "Location needs HTTPS (or localhost).";
  }
  if (err.code === err.TIMEOUT) return "Still waiting for a GPS fix.";
  return "This device can't determine its location.";
}

/** Watches the device position while mounted. Every hand-off records a fix. */
export function useGpsWatch(): { fix: GpsFix | null; error: string | null } {
  const [fix, setFix] = useState<GpsFix | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setError("This browser can't share its location.");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: Math.round(p.coords.accuracy), source: GpsSource.DEVICE });
        setError(null);
      },
      (err) => setError(describeGeoError(err)),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  return { fix, error };
}

/** Stand-in when the device has no fix: the facility's coordinates, flagged as such in the record. */
export function facilityFix(facility: Facility): GpsFix {
  return { lat: facility.lat, lng: facility.lng, accuracyM: null, source: GpsSource.FACILITY_FALLBACK };
}
