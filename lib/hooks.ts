import { useEffect, useState } from "react";
import { DomainError } from "./domain";
import { can } from "./permissions";
import { useSessionUser } from "./session";
import { run, useDemo } from "./store";
import { toast } from "./toast";
import type { DemoState, Permission, User } from "./types";

/** Demo state inside <AppShell>, which only renders once it has loaded. */
export function useData(): DemoState {
  const state = useDemo();
  if (!state) throw new Error("useData() must be used inside <AppShell>");
  return state;
}

/** The signed-in user inside <AppShell>, which only renders once someone is. */
export function useUser(): User {
  const user = useSessionUser();
  if (!user) throw new Error("useUser() must be used inside <AppShell>");
  return user;
}

/** Whether the signed-in user may do something, under the role permissions the admin has set. */
export function useCan(): (permission: Permission | "manageUsers") => boolean {
  const state = useData();
  const user = useUser();
  return (permission) => can(state, user, permission);
}

/** A clock that re-renders every `intervalMs`. */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/**
 * Runs a domain command from the UI: rule violations become an error toast,
 * success optionally becomes a confirmation. Returns null if it was refused.
 */
export function execute<R extends { state: DemoState }>(
  command: (state: DemoState) => R,
  success?: string | ((result: R) => string),
): R | null {
  try {
    const result = run(command);
    if (success) toast.success(typeof success === "function" ? success(result) : success);
    return result;
  } catch (err) {
    if (err instanceof DomainError) {
      toast.error(err.message);
    } else {
      console.error(err);
      toast.error("Something went wrong. Details are in the browser console.");
    }
    return null;
  }
}
