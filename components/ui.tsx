import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { PersonState } from "@/lib/selectors";
import type { AlertType, AssetState, CustodyEventType, TripState } from "@/lib/types";

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

export type Tone = "slate" | "blue" | "emerald" | "amber" | "red" | "orange" | "violet";

const TONE: Record<Tone, string> = {
  slate: "bg-slate-100 text-slate-700 ring-slate-600/15",
  blue: "bg-blue-50 text-blue-700 ring-blue-600/20",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/25",
  red: "bg-red-50 text-red-700 ring-red-600/20",
  orange: "bg-orange-50 text-orange-700 ring-orange-600/25",
  violet: "bg-violet-50 text-violet-700 ring-violet-600/20",
};

export const ASSET_STATE_TONE: Record<AssetState, Tone> = {
  IN_WAREHOUSE: "slate",
  IN_TRANSIT: "blue",
  AT_STATION: "emerald",
  RETURNED: "violet",
  MISSING: "red",
};

export const TRIP_STATE_TONE: Record<TripState, Tone> = {
  PLANNED: "slate",
  IN_TRANSIT: "blue",
  ARRIVED: "amber",
  CLOSED: "emerald",
};

export const ALERT_TONE: Record<AlertType, Tone> = {
  MANIFEST_MISMATCH: "red",
  ROUTE_DEVIATION: "orange",
  UNSCHEDULED_STOP: "amber",
  CREW_LEFT_VEHICLE: "red",
  CREW_AWAY_FROM_VEHICLE: "red",
  ASSET_NOT_DETECTED: "red",
};

/** Where a person is, relative to their vehicle (lib/selectors.ts personStatus). */
export const PERSON_STATE_TONE: Record<PersonState, Tone> = {
  ON_BOARD: "blue",
  BADGE_NOT_READ: "amber",
  AWAY: "red",
  AT_FACILITY: "emerald",
  ELSEWHERE: "slate",
  UNKNOWN: "slate",
};

/** Map colours for people, matching PERSON_STATE_TONE. */
export const PERSON_STATE_COLOR: Record<PersonState, string> = {
  ON_BOARD: "#2563eb",
  BADGE_NOT_READ: "#d97706",
  AWAY: "#dc2626",
  AT_FACILITY: "#059669",
  ELSEWHERE: "#64748b",
  UNKNOWN: "#94a3b8",
};

export const CUSTODY_TONE: Record<CustodyEventType, Tone> = {
  INTAKE: "slate",
  LOAD: "blue",
  RECEIVE: "emerald",
  REPORT_MISSING: "red",
};

/** Map colours for custody scan points, matching CUSTODY_TONE. */
export const CUSTODY_COLOR: Record<CustodyEventType, string> = {
  INTAKE: "#64748b",
  LOAD: "#2563eb",
  RECEIVE: "#059669",
  REPORT_MISSING: "#dc2626",
};

export function Badge({ tone = "slate", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const VARIANT = {
  primary: "bg-slate-900 text-white hover:bg-slate-800",
  secondary: "bg-white text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-50",
  danger: "bg-red-600 text-white hover:bg-red-500",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
};

const SIZE = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-5 text-base",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof VARIANT; size?: keyof typeof SIZE };

export function Button({ variant = "primary", size = "md", className, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600",
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...props}
    />
  );
}

export function Card({
  title,
  subtitle,
  action,
  flush,
  className,
  children,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  /** No inner padding (tables, lists). */
  flush?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cx("rounded-xl bg-white shadow-sm ring-1 ring-slate-200", className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-slate-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={flush ? undefined : "p-4"}>{children}</div>
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "block w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 " +
  "placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-50 disabled:text-slate-500";

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {children && <div className="mt-1 text-sm text-slate-500">{children}</div>}
    </div>
  );
}

/** A toggleable filter pill. */
export function chipClass(active: boolean): string {
  return cx(
    "rounded-full px-3 py-1 text-sm ring-1 ring-inset",
    active ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50",
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "red" | "emerald" }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-inset ring-slate-200">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div
        className={cx(
          "mt-0.5 text-lg font-semibold tabular-nums",
          tone === "red" ? "text-red-600" : tone === "emerald" ? "text-emerald-600" : "text-slate-900",
        )}
      >
        {value}
      </div>
    </div>
  );
}
