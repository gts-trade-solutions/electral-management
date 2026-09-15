/**
 * Browser persistence for the demo. There is no backend: state lives in
 * localStorage, so it survives reloads (and load-shedding) but stays on this
 * device. Every change goes through run() with a lib/domain.ts command.
 */
import { useSyncExternalStore } from "react";
import { APP_NAME, STORAGE_PREFIX } from "./brand";
import { buildSeed } from "./seed";
import { SCHEMA_VERSION, type DemoState } from "./types";

const STORAGE_KEY = `${STORAGE_PREFIX}:demo`;
/** Keys saved under the app's earlier name, cleared so they don't use up the browser's storage quota. */
const LEGACY_PREFIX = "indlela:";

let memory: DemoState | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/**
 * Whether data has the shape this build expects. Anything else (saved by an
 * older build, or by a half-updated dev session) is discarded and the demo is
 * reseeded, rather than letting a screen crash on a missing field.
 */
function isCurrent(value: unknown): value is DemoState {
  const s = value as Partial<DemoState> | null;
  return (
    !!s &&
    s.schemaVersion === SCHEMA_VERSION &&
    [s.users, s.facilities, s.vehicles, s.assets, s.trips, s.custodyEvents, s.gpsPings, s.userPings, s.rfidEvents, s.alerts, s.activity].every(
      Array.isArray,
    ) &&
    typeof s.settings === "object" &&
    s.settings !== null &&
    typeof s.settings.crewAwayMetres === "number" &&
    typeof s.rolePermissions === "object" &&
    s.rolePermissions !== null
  );
}

function readSaved(): DemoState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isCurrent(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function save(state: DemoState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn(`${APP_NAME}: could not save demo data; changes will last until the page closes.`, err);
  }
}

function clearLegacy(): void {
  try {
    const storage = window.localStorage;
    for (let i = storage.length - 1; i >= 0; i--) {
      const key = storage.key(i);
      if (key?.startsWith(LEGACY_PREFIX)) storage.removeItem(key);
    }
  } catch {
    // No storage access: nothing to clear.
  }
}

/** Loads saved data, or seeds it when there is none (or it's from an older build). Client only. */
export function loadDemo(): DemoState {
  if (isCurrent(memory)) return memory;
  clearLegacy();
  const saved = readSaved();
  const next = saved ?? buildSeed(Date.now());
  memory = next;
  if (!saved) save(next);
  emit();
  return next;
}

/**
 * Applies a domain command and saves the result. Commands start from the
 * saved copy when there is one, so two tabs (say, the map and the scanner)
 * don't overwrite each other's changes.
 */
export function run<R extends { state: DemoState }>(command: (state: DemoState) => R): R {
  const base = readSaved() ?? loadDemo();
  const result = command(base);
  const next: DemoState = { ...result.state, rev: base.rev + 1 };
  memory = next;
  save(next);
  emit();
  return { ...result, state: next };
}

/** Throws away every change and rebuilds the seed relative to now. */
export function resetDemo(): void {
  memory = { ...buildSeed(Date.now()), rev: (memory?.rev ?? 0) + 1 };
  save(memory);
  emit();
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    memory = readSaved() ?? memory;
    emit();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const currentSnapshot = () => (isCurrent(memory) ? memory : null);

/** The whole demo state, stable until it changes. null on the server, before loadDemo(), and for out-of-date data. */
export function useDemo(): DemoState | null {
  return useSyncExternalStore(subscribe, currentSnapshot, () => null);
}
