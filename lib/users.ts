import { EMAIL_DOMAIN } from "./brand";
import { Role, type User } from "./types";

/** Password for every seeded field account: the people on vehicles, and the presiding officer. */
export const FIELD_PASSWORD = "Field#2026";

/**
 * The office accounts every fresh demo starts with. Field accounts are seeded
 * with their vehicles in lib/seed.ts. Admins add, change and deactivate
 * accounts on the Admin screen. Checked in the browser: a role switcher for
 * demos, not security.
 */
export const SEED_STAFF: readonly User[] = [
  {
    id: "0b6f2a4e-1c3d-4e5f-8a9b-0c1d2e3f4a01",
    name: "Thandeka Nkosi",
    email: `admin@${EMAIL_DOMAIN}`,
    role: Role.ADMIN,
    password: "Admin#2026",
    active: true,
    phone: "+27820000201",
    rfidBadge: null,
    vehicleId: null,
    duty: null,
  },
  {
    id: "0b6f2a4e-1c3d-4e5f-8a9b-0c1d2e3f4a02",
    name: "Johan Botha",
    email: `coordinator@${EMAIL_DOMAIN}`,
    role: Role.COORDINATOR,
    password: "Coord#2026",
    active: true,
    phone: "+27820000202",
    rfidBadge: null,
    vehicleId: null,
    duty: null,
  },
  {
    id: "0b6f2a4e-1c3d-4e5f-8a9b-0c1d2e3f4a03",
    name: "Sipho Dlamini",
    email: `officer@${EMAIL_DOMAIN}`,
    role: Role.OFFICER,
    password: "Officer#2026",
    active: true,
    phone: "+27820000203",
    rfidBadge: null,
    vehicleId: null,
    duty: null,
  },
];

export const ROLE_SUMMARY: Record<Role, string> = {
  ADMIN: "Everything, including users, roles and alert settings",
  COORDINATOR: "Trips, vehicles and who is on them, tracking people, the map and alerts",
  OFFICER: "Scan assets and record hand-offs",
  CREW: "Rides on a vehicle (driver, escort, SAPS) and shares their location from their phone",
};
