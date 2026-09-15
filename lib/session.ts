/**
 * Demo sign-in, remembered in localStorage. Accounts live in the demo data,
 * where the admin manages them. A role switcher, not security.
 */
import { useSyncExternalStore } from "react";
import { STORAGE_PREFIX } from "./brand";
import { recordSession } from "./domain";
import { loadDemo, run, useDemo } from "./store";
import type { User } from "./types";

const STORAGE_KEY = `${STORAGE_PREFIX}:session`;

let currentId: string | null | undefined; // undefined until read on the client
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

function snapshot(): string | null {
  if (currentId === undefined) {
    try {
      currentId = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      currentId = null;
    }
  }
  return currentId;
}

function setCurrent(id: string | null): void {
  currentId = id;
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode without storage: the session lasts until the tab closes.
  }
  emit();
}

/** Every sign-in and sign-out goes in the activity log. */
function logSession(userId: string, signedIn: boolean): void {
  try {
    run((s) => recordSession(s, userId, signedIn, new Date()));
  } catch {
    // The account vanished (a reset in another tab): nothing to log against.
  }
}

export function signIn(email: string, password: string): User | null {
  const wanted = email.trim().toLowerCase();
  const user = loadDemo().users.find((u) => u.active && u.email === wanted && u.password === password);
  if (user) {
    setCurrent(user.id);
    logSession(user.id, true);
  }
  return user ?? null;
}

export function signInAs(userId: string): void {
  if (!loadDemo().users.some((u) => u.id === userId && u.active)) return;
  setCurrent(userId);
  logSession(userId, true);
}

export function signOut(): void {
  const id = snapshot();
  if (id) logSession(id, false);
  setCurrent(null);
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    currentId = event.newValue;
    emit();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The signed-in user as the demo data has them now: null when signed out or
 * deactivated, undefined while storage or the demo data is still loading.
 */
export function useSessionUser(): User | null | undefined {
  const id = useSyncExternalStore<string | null | undefined>(subscribe, snapshot, () => undefined);
  const state = useDemo();
  if (id === undefined || !state) return undefined;
  return state.users.find((u) => u.id === id && u.active) ?? null;
}
