import { useSyncExternalStore } from "react";

export type Toast = { id: number; tone: "success" | "error" | "info"; text: string };

let toasts: Toast[] = [];
let seq = 0;
const EMPTY: Toast[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

function push(tone: Toast["tone"], text: string, ms: number) {
  const next = { id: ++seq, tone, text };
  toasts = [...toasts, next].slice(-4);
  emit();
  setTimeout(() => dismissToast(next.id), ms);
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export const toast = {
  success: (text: string) => push("success", text, 5000),
  info: (text: string) => push("info", text, 5000),
  error: (text: string) => push("error", text, 9000),
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, () => toasts, () => EMPTY);
}
