/**
 * BallotRoute domain model.
 *
 * Shaped like the relational design so a database can slot in later without
 * reshaping anything. In this MVP everything lives in the browser (lib/store.ts).
 *
 * IDs are UUIDs. Coordinates are WGS84 decimal degrees. Times are ISO-8601 UTC
 * strings, displayed in SAST (UTC+2, no DST) by lib/format.ts. RFID tags are
 * 96-bit EPCs stored as 24 uppercase hex characters.
 *
 * Every person is a User: they sign in, have a role (what they may do), may be
 * assigned to a vehicle with a duty on it, carry an RFID badge, and share their
 * phone's location. Everything they do is recorded in the activity log.
 *
 * South Africa votes on PAPER BALLOTS; nothing here models a voting machine.
 * The only electronic asset is the VMD (Voter Management Device), a handheld
 * tablet that checks a voter is at their registered voting district.
 */

/** What a person may do in the app. CREW are the people who ride on vehicles (drivers, escorts, SAPS). */
export const Role = { ADMIN: "ADMIN", COORDINATOR: "COORDINATOR", OFFICER: "OFFICER", CREW: "CREW" } as const;
export type Role = (typeof Role)[keyof typeof Role];
/** Roles whose permissions the admin can change. Admins always have every permission. */
export type ConfigurableRole = Exclude<Role, typeof Role.ADMIN>;

export const PERMISSIONS = [
  "createTrip",
  "editManifest",
  "dispatchTrip",
  "closeTrip",
  "acknowledgeAlert",
  "runSimulator",
  "recordCustody",
  "manageVehicles",
  "trackPeople",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const FacilityType = { WAREHOUSE: "WAREHOUSE", VOTING_STATION: "VOTING_STATION" } as const;
export type FacilityType = (typeof FacilityType)[keyof typeof FacilityType];

export const AssetType = { VMD: "VMD", BALLOT_BOX: "BALLOT_BOX", BALLOT_PAPERS: "BALLOT_PAPERS" } as const;
export type AssetType = (typeof AssetType)[keyof typeof AssetType];

export const AssetState = {
  IN_WAREHOUSE: "IN_WAREHOUSE",
  IN_TRANSIT: "IN_TRANSIT",
  AT_STATION: "AT_STATION",
  RETURNED: "RETURNED",
  MISSING: "MISSING",
} as const;
export type AssetState = (typeof AssetState)[keyof typeof AssetState];

export const VehicleStatus = { AVAILABLE: "AVAILABLE", ON_TRIP: "ON_TRIP", OUT_OF_SERVICE: "OUT_OF_SERVICE" } as const;
export type VehicleStatus = (typeof VehicleStatus)[keyof typeof VehicleStatus];

export const TripState = { PLANNED: "PLANNED", IN_TRANSIT: "IN_TRANSIT", ARRIVED: "ARRIVED", CLOSED: "CLOSED" } as const;
export type TripState = (typeof TripState)[keyof typeof TripState];

export const CustodyEventType = {
  INTAKE: "INTAKE", // first receipt into a warehouse (or a missing asset recovered)
  LOAD: "LOAD", // released from a facility onto a trip's vehicle
  RECEIVE: "RECEIVE", // taken off a trip's vehicle into the destination facility
  REPORT_MISSING: "REPORT_MISSING", // explicit, attributed report that an asset cannot be found
} as const;
export type CustodyEventType = (typeof CustodyEventType)[keyof typeof CustodyEventType];

/** A person's duty on the vehicle they're assigned to. */
export const CrewRole = {
  DRIVER: "DRIVER",
  ESCORT: "ESCORT",
  ELECTORAL_OFFICER: "ELECTORAL_OFFICER",
  SAPS_OFFICER: "SAPS_OFFICER",
} as const;
export type CrewRole = (typeof CrewRole)[keyof typeof CrewRole];

export const AlertType = {
  MANIFEST_MISMATCH: "MANIFEST_MISMATCH", // closure refused
  ROUTE_DEVIATION: "ROUTE_DEVIATION", // more than 2 km off the planned route
  UNSCHEDULED_STOP: "UNSCHEDULED_STOP", // standing still away from any facility for too long
  CREW_LEFT_VEHICLE: "CREW_LEFT_VEHICLE", // a crew badge stopped being read away from any facility
  CREW_AWAY_FROM_VEHICLE: "CREW_AWAY_FROM_VEHICLE", // a crew member's phone is too far from their vehicle
  ASSET_NOT_DETECTED: "ASSET_NOT_DETECTED", // a loaded asset's tag stopped being read in transit
} as const;
export type AlertType = (typeof AlertType)[keyof typeof AlertType];

export const RfidEventKind = {
  GATE_OUT: "GATE_OUT", // vehicle tag read leaving the origin
  GATE_IN: "GATE_IN", // vehicle tag read arriving at the destination
  CREW_OFF: "CREW_OFF", // a crew badge stopped being read inside the vehicle
  CREW_ON: "CREW_ON", // ...and was read again
  ASSET_MISSING: "ASSET_MISSING", // a loaded asset's tag stopped being read
  ASSET_FOUND: "ASSET_FOUND", // ...and was read again
} as const;
export type RfidEventKind = (typeof RfidEventKind)[keyof typeof RfidEventKind];

/** What a person did, grouped for the activity log. */
export const ActivityKind = {
  SESSION: "SESSION",
  TRIP: "TRIP",
  MANIFEST: "MANIFEST",
  HANDOFF: "HANDOFF",
  ALERT: "ALERT",
  VEHICLE: "VEHICLE",
  ASSIGNMENT: "ASSIGNMENT",
  ACCOUNT: "ACCOUNT",
  SETTINGS: "SETTINGS",
} as const;
export type ActivityKind = (typeof ActivityKind)[keyof typeof ActivityKind];

/** Where a person-location ping came from. */
export const PingSource = { PHONE: "PHONE", SIMULATED: "SIMULATED" } as const;
export type PingSource = (typeof PingSource)[keyof typeof PingSource];

/** Where a custody record's coordinates came from. */
export const GpsSource = {
  DEVICE: "DEVICE", // the scanning device's own GPS fix
  FACILITY_FALLBACK: "FACILITY_FALLBACK", // device had no fix; facility location recorded and flagged
} as const;
export type GpsSource = (typeof GpsSource)[keyof typeof GpsSource];

/** [lat, lng]: the order trip.plannedRoute is stored in. GeoJSON is [lng, lat]. */
export type LatLng = [lat: number, lng: number];
export type Fix = { lat: number; lng: number };
export type GpsFix = Fix & { accuracyM: number | null; source: GpsSource };

export type User = {
  id: string;
  email: string;
  name: string;
  /** What they may do in the app. */
  role: Role;
  /** Demo only: stored and checked in the browser. */
  password: string;
  active: boolean;
  /** E.164, e.g. +27821234567 */
  phone: string | null;
  /** EPC of their RFID badge, read by vehicle readers. */
  rfidBadge: string | null;
  /** The vehicle they're assigned to, and their duty on it. */
  vehicleId: string | null;
  duty: CrewRole | null;
};

export type Facility = {
  id: string;
  name: string;
  type: FacilityType;
  municipality: string;
  province: string;
  lat: number;
  lng: number;
};

/**
 * Position = state + currentFacilityId + currentTripId
 *   IN_WAREHOUSE | AT_STATION | RETURNED   at currentFacilityId
 *       + currentTripId set                ...and picked for that PLANNED trip
 *   IN_TRANSIT                             on currentTripId's vehicle
 *   MISSING                                location unknown
 */
export type Asset = {
  id: string;
  /** Printed on the asset's barcode; what the Scan screen reads. */
  serial: string;
  /** EPC of the RFID tag fixed to the asset, read by vehicle readers. */
  rfidTag: string;
  type: AssetType;
  state: AssetState;
  currentFacilityId: string | null;
  currentTripId: string | null;
};

/** What a vehicle's in-cab RFID reader saw on its latest read. */
export type OnboardRead = {
  /** User IDs whose badges were read. */
  crewIds: string[];
  assetIds: string[];
  readAt: string;
  lat: number;
  lng: number;
};

export type Vehicle = {
  id: string;
  /** SA plate, e.g. "JK 21 LM GP". */
  registration: string;
  status: VehicleStatus;
  /** EPC of the windscreen tag, read at warehouse and station gates. */
  rfidTag: string;
  /** The in-cab reader that counts crew badges and asset tags on board. */
  readerId: string;
  seats: number;
  /** Latest reader snapshot while on a trip; null when parked. */
  onboard: OnboardRead | null;
};

export type Trip = {
  id: string;
  originFacilityId: string;
  destFacilityId: string;
  vehicleId: string;
  state: TripState;
  /** [[lat, lng], ...] from origin to destination. NOT GeoJSON order. */
  plannedRoute: LatLng[];
  departedAt: string | null;
  arrivedAt: string | null;
  closedAt: string | null;
  createdAt: string;
};

/** Append-only: never edited or deleted once recorded (see lib/domain.ts). */
export type CustodyEvent = Readonly<{
  id: string;
  type: CustodyEventType;
  assetId: string;
  tripId: string | null;
  fromFacilityId: string | null;
  toFacilityId: string | null;
  /** The user who recorded the hand-off (null for people without an account). */
  officerId: string | null;
  officerName: string;
  /** Who holds the asset after this hand-off (the driver after a load); null when missing. */
  custodian: string | null;
  sealNumber: string | null;
  /** Where the scanning device was at the moment of hand-off. */
  lat: number;
  lng: number;
  gpsAccuracyM: number | null;
  gpsSource: GpsSource;
  createdAt: string;
}>;

/** A vehicle tracker's position. */
export type GpsPing = {
  id: string;
  tripId: string;
  lat: number;
  lng: number;
  recordedAt: string;
};

/** A person's position, from the phone they're signed in on. */
export type UserPing = {
  id: string;
  userId: string;
  lat: number;
  lng: number;
  accuracyM: number | null;
  source: PingSource;
  /** Their vehicle's trip, when it was on the road at the time. */
  tripId: string | null;
  /** How far they were from that vehicle, in metres. */
  vehicleDistanceM: number | null;
  /** Whether that was beyond the allowed distance. */
  away: boolean;
  recordedAt: string;
};

/** A change seen by an RFID reader: a gate read, or a badge or tag appearing or disappearing on board. */
export type RfidEvent = {
  id: string;
  vehicleId: string;
  tripId: string | null;
  kind: RfidEventKind;
  /** The user or asset concerned; null for gate reads. */
  subjectId: string | null;
  lat: number;
  lng: number;
  at: string;
};

/** Append-only record of something a person did. */
export type ActivityEntry = Readonly<{
  id: string;
  /** Who did it. */
  userId: string;
  kind: ActivityKind;
  summary: string;
  tripId: string | null;
  assetId: string | null;
  vehicleId: string | null;
  /** The person it was done to, e.g. who was assigned to a vehicle. */
  subjectUserId: string | null;
  lat: number | null;
  lng: number | null;
  at: string;
}>;

export type Alert = {
  id: string;
  tripId: string;
  type: AlertType;
  message: string;
  /** Where it happened, when that's known (not for manifest mismatches). */
  lat: number | null;
  lng: number | null;
  /** The person it's about, for crew alerts. */
  userId: string | null;
  acknowledged: boolean;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
};

export type Settings = {
  /** Raise UNSCHEDULED_STOP after a vehicle stands still this long away from a facility. */
  stopAlertMinutes: number;
  /** Raise CREW_AWAY_FROM_VEHICLE when a crew member's phone is this far from their moving vehicle. */
  crewAwayMetres: number;
};

export const SCHEMA_VERSION = 3;

export type DemoState = {
  schemaVersion: typeof SCHEMA_VERSION;
  /** Bumped on every write; lets tabs tell whose copy is newer. */
  rev: number;
  seededAt: string;
  users: User[];
  facilities: Facility[];
  vehicles: Vehicle[];
  assets: Asset[];
  trips: Trip[];
  custodyEvents: readonly CustodyEvent[];
  gpsPings: GpsPing[];
  userPings: UserPing[];
  rfidEvents: RfidEvent[];
  alerts: Alert[];
  activity: readonly ActivityEntry[];
  settings: Settings;
  rolePermissions: Record<ConfigurableRole, Permission[]>;
};
