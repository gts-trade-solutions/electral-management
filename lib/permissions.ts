import { PERMISSIONS, Role, type ConfigurableRole, type DemoState, type Permission, type User } from "./types";

export const PERMISSION_LABEL: Record<Permission, string> = {
  createTrip: "Create trips",
  editManifest: "Pick and remove manifest assets",
  dispatchTrip: "Dispatch trips",
  closeTrip: "Close trips",
  acknowledgeAlert: "Acknowledge alerts",
  runSimulator: "Run the GPS simulator",
  recordCustody: "Record hand-offs (scan)",
  manageVehicles: "Manage vehicles and assign people to them",
  trackPeople: "Track people: where everyone is and what they've done",
};

/** What each role starts with. The admin changes these on the Admin screen. */
export const DEFAULT_ROLE_PERMISSIONS: Record<ConfigurableRole, Permission[]> = {
  COORDINATOR: ["createTrip", "editManifest", "dispatchTrip", "closeTrip", "acknowledgeAlert", "runSimulator", "manageVehicles", "trackPeople"],
  OFFICER: ["recordCustody"],
  CREW: [],
};

/**
 * Admins can do everything, including managing users and roles, which only
 * admins can ever do (so nobody can lock the admins out). Other roles have
 * whatever the admin has granted them. Deactivated accounts can do nothing.
 */
export function can(
  state: Pick<DemoState, "rolePermissions">,
  user: User | null | undefined,
  permission: Permission | "manageUsers",
): boolean {
  if (!user?.active) return false;
  if (user.role === Role.ADMIN) return true;
  if (permission === "manageUsers") return false;
  return state.rolePermissions[user.role].includes(permission);
}

/** A role's permissions with one switched on or off, kept in the canonical order. */
export function withPermission(current: readonly Permission[], permission: Permission, allowed: boolean): Permission[] {
  return PERMISSIONS.filter((p) => (p === permission ? allowed : current.includes(p)));
}
