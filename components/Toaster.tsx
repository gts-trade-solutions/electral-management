"use client";

import { CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { dismissToast, useToasts } from "@/lib/toast";
import { cx } from "./ui";

const STYLE = {
  success: { Icon: CircleCheck, ring: "ring-emerald-200", icon: "text-emerald-600" },
  info: { Icon: Info, ring: "ring-blue-200", icon: "text-blue-600" },
  error: { Icon: TriangleAlert, ring: "ring-red-300", icon: "text-red-600" },
};

export function Toaster() {
  const toasts = useToasts();
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-3 bottom-20 z-50 flex flex-col gap-2 md:inset-x-auto md:bottom-4 md:right-4 md:w-96"
    >
      {toasts.map((t) => {
        const { Icon, ring, icon } = STYLE[t.tone];
        return (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className={cx("pointer-events-auto flex items-start gap-3 rounded-lg bg-white px-3 py-2.5 text-sm shadow-lg ring-1", ring)}
          >
            <Icon className={cx("mt-0.5 size-4 shrink-0", icon)} aria-hidden />
            <p className="flex-1 text-slate-800">{t.text}</p>
            <button type="button" onClick={() => dismissToast(t.id)} className="text-slate-400 hover:text-slate-600" aria-label="Dismiss">
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
