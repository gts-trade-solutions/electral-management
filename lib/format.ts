import type {
  ActivityKind,
  AlertType,
  AssetState,
  AssetType,
  CrewRole,
  CustodyEventType,
  RfidEventKind,
  Role,
  TripState,
  VehicleStatus,
} from "./types";

// South Africa is UTC+2 all year (no daylight saving), so SAST is a fixed
// offset: no timezone database needed, and output is identical everywhere.
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const two = (n: number) => String(n).padStart(2, "0");
const wall = (iso: string) => new Date(Date.parse(iso) + SAST_OFFSET_MS);

/** "07:10" */
export function sastTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = wall(iso);
  return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

/** "Wed 9 Sep, 07:10" */
export function sastDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = wall(iso);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${sastTime(iso)}`;
}

/** "2026-09-09 07:10:32 SAST" */
export function sastStamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = wall(iso);
  const date = `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
  return `${date} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())} SAST`;
}

export function timeAgo(iso: string | null | undefined, nowMs = Date.now()): string {
  if (!iso) return "never";
  const seconds = Math.round((nowMs - Date.parse(iso)) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/** "0:42", "12:05" */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes * 60));
  return `${Math.floor(total / 60)}:${two(total % 60)}`;
}

export function formatKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 100) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString("en-ZA")} km`;
}

export const LABEL = {
  assetType: { VMD: "VMD", BALLOT_BOX: "Ballot box", BALLOT_PAPERS: "Ballot papers" } satisfies Record<AssetType, string>,
  assetState: {
    IN_WAREHOUSE: "In warehouse",
    IN_TRANSIT: "In transit",
    AT_STATION: "At station",
    RETURNED: "Returned",
    MISSING: "Missing",
  } satisfies Record<AssetState, string>,
  tripState: { PLANNED: "Planned", IN_TRANSIT: "In transit", ARRIVED: "Arrived", CLOSED: "Closed" } satisfies Record<TripState, string>,
  custody: {
    INTAKE: "Intake",
    LOAD: "Loaded",
    RECEIVE: "Received",
    REPORT_MISSING: "Reported missing",
  } satisfies Record<CustodyEventType, string>,
  alertType: {
    MANIFEST_MISMATCH: "Manifest mismatch",
    ROUTE_DEVIATION: "Route deviation",
    UNSCHEDULED_STOP: "Unscheduled stop",
    CREW_LEFT_VEHICLE: "Crew left vehicle",
    CREW_AWAY_FROM_VEHICLE: "Crew away from vehicle",
    ASSET_NOT_DETECTED: "Asset not detected",
  } satisfies Record<AlertType, string>,
  vehicleStatus: { AVAILABLE: "Available", ON_TRIP: "On trip", OUT_OF_SERVICE: "Out of service" } satisfies Record<VehicleStatus, string>,
  role: { ADMIN: "Admin", COORDINATOR: "Coordinator", OFFICER: "Officer", CREW: "Crew" } satisfies Record<Role, string>,
  crewRole: {
    DRIVER: "Driver",
    ESCORT: "Escort",
    ELECTORAL_OFFICER: "Electoral officer",
    SAPS_OFFICER: "SAPS officer",
  } satisfies Record<CrewRole, string>,
  rfid: {
    GATE_OUT: "Left through the gate",
    GATE_IN: "Arrived through the gate",
    CREW_OFF: "Crew stepped out",
    CREW_ON: "Crew back on board",
    ASSET_MISSING: "Asset tag not detected",
    ASSET_FOUND: "Asset tag detected again",
  } satisfies Record<RfidEventKind, string>,
  activity: {
    SESSION: "Sign-in",
    TRIP: "Trip",
    MANIFEST: "Manifest",
    HANDOFF: "Hand-off",
    ALERT: "Alert",
    VEHICLE: "Vehicle",
    ASSIGNMENT: "Assignment",
    ACCOUNT: "Account",
    SETTINGS: "Settings",
  } satisfies Record<ActivityKind, string>,
};
