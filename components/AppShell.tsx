"use client";

import {
  BellRing,
  ChevronDown,
  LogOut,
  MapIcon,
  Package,
  RotateCcw,
  Route,
  ScanLine,
  ShieldCheck,
  Truck,
  UserRound,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import { LABEL, sastTime } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { can } from "@/lib/permissions";
import { signOut, useSessionUser } from "@/lib/session";
import { stopSimulation, useSimulation } from "@/lib/simulator";
import { loadDemo, resetDemo, useDemo } from "@/lib/store";
import { toast } from "@/lib/toast";
import type { Permission, User } from "@/lib/types";
import { LocationSharer } from "./LocationSharer";
import { Toaster } from "./Toaster";
import { cx } from "./ui";

type NavItem = { href: string; label: string; Icon: LucideIcon; permission?: Permission };

const NAV: NavItem[] = [
  { href: "/map", label: "Map", Icon: MapIcon },
  { href: "/assets", label: "Assets", Icon: Package },
  { href: "/trips", label: "Trips", Icon: Route },
  { href: "/vehicles", label: "Vehicles", Icon: Truck },
  { href: "/people", label: "People", Icon: UsersRound, permission: "trackPeople" },
  { href: "/scan", label: "Scan", Icon: ScanLine },
  { href: "/alerts", label: "Alerts", Icon: BellRing },
];
const ADMIN_NAV: NavItem = { href: "/admin", label: "Admin", Icon: ShieldCheck };

/** A ticked ballot paper going into a ballot box. Drawn for a dark background. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
      <path d="M8 12V4.8a1.3 1.3 0 0 1 1.3-1.3h5.4A1.3 1.3 0 0 1 16 4.8V12" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="m10 8 1.5 1.5 2.6-3" stroke="#f59e0b" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 12h16v7.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19.5z" fill="currentColor" />
      <path d="M10 16.5h4" stroke="#0f172a" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** Signed-in chrome for every screen. Renders nothing until the session and demo data are ready. */
export function AppShell({ children }: { children: ReactNode }) {
  const user = useSessionUser();
  const data = useDemo();
  const router = useRouter();
  const pathname = usePathname();

  // Load the demo data whenever it isn't there: the first visit, or data an older build left behind.
  useEffect(() => {
    if (!data) loadDemo();
  }, [data]);

  useEffect(() => {
    if (user === null) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [user, router, pathname]);

  if (!user || !data) {
    return <div className="grid min-h-dvh place-items-center text-sm text-slate-500">Loading {APP_NAME}…</div>;
  }

  const openAlerts = data.alerts.filter((a) => !a.acknowledged).length;
  const isAdmin = can(data, user, "manageUsers");
  const nav = NAV.filter((item) => !item.permission || can(data, user, item.permission));
  const desktopNav = isAdmin ? [...nav, ADMIN_NAV] : nav;
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 bg-slate-900 px-4 text-white">
        <Link href="/map" className="flex shrink-0 items-center gap-2" title={`${APP_NAME} · ${APP_TAGLINE}`}>
          <Logo className="size-7" />
          <span className="leading-tight">
            <span className="block font-semibold tracking-wide">{APP_NAME}</span>
            <span className="hidden text-[10px] font-medium uppercase tracking-wider text-amber-400/90 xl:block">{APP_TAGLINE}</span>
          </span>
        </Link>

        <nav className="ml-2 hidden items-center gap-0.5 md:flex">
          {desktopNav.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              title={label}
              className={cx(
                "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm",
                isActive(href) ? "bg-white/15 text-white" : "text-slate-300 hover:bg-white/10 hover:text-white",
              )}
            >
              <Icon className="size-4" aria-hidden />
              <span className="hidden xl:inline">{label}</span>
              {href === "/alerts" && openAlerts > 0 && (
                <span className="rounded-full bg-red-500 px-1.5 text-[11px] font-semibold leading-5 text-white">{openAlerts}</span>
              )}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <LocationSharer user={user} />
          <SimulatorPill />
          <SastClock />
          <UserMenu user={user} isAdmin={isAdmin} onSignOut={() => router.replace("/login")} />
        </div>
      </header>

      <main className="flex-1 pb-16 md:pb-0">{children}</main>

      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid h-16 border-t border-slate-200 bg-white md:hidden"
        style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))` }}
      >
        {nav.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            className={cx(
              "relative flex flex-col items-center justify-center gap-1 text-[10px]",
              isActive(href) ? "text-slate-900" : "text-slate-500",
            )}
          >
            <Icon className="size-5" aria-hidden />
            {label}
            {href === "/alerts" && openAlerts > 0 && (
              <span className="absolute right-[calc(50%-1.1rem)] top-2 rounded-full bg-red-500 px-1.5 text-[10px] font-semibold leading-4 text-white">
                {openAlerts}
              </span>
            )}
          </Link>
        ))}
      </nav>

      <Toaster />
    </div>
  );
}

function SastClock() {
  const now = useNow(15_000);
  return (
    <span className="hidden whitespace-nowrap text-sm tabular-nums text-slate-300 sm:inline" title="South African Standard Time (UTC+2)">
      {sastTime(new Date(now).toISOString())}
      <span className="hidden 2xl:inline"> SAST</span>
    </span>
  );
}

function SimulatorPill() {
  const { status } = useSimulation();
  if (!status) return null;
  return (
    <Link
      href={`/map?trip=${status.tripId}`}
      title="The GPS simulator is running. Open its trip on the map."
      className="flex items-center gap-1.5 whitespace-nowrap rounded-full bg-blue-500/20 px-2.5 py-1 text-xs text-blue-100"
    >
      <span className="size-2 animate-pulse rounded-full bg-blue-400" />
      <span className="hidden sm:inline">Simulating</span>
    </Link>
  );
}

function UserMenu({ user, isAdmin, onSignOut }: { user: User; isAdmin: boolean; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const reset = () => {
    setOpen(false);
    if (!window.confirm("Reset the demo? Every trip, scan, vehicle, user and alert recorded in this browser is replaced with the original data.")) return;
    stopSimulation(null);
    resetDemo();
    toast.success("Demo data reset.");
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-white/10"
        aria-expanded={open}
      >
        <span className="grid size-7 place-items-center rounded-full bg-amber-500 text-[11px] font-bold text-slate-900">
          {user.name.split(" ").map((p) => p[0]).join("").slice(0, 2)}
        </span>
        <span className="hidden whitespace-nowrap leading-tight min-[1400px]:block">
          <span className="block text-sm">{user.name}</span>
          <span className="block text-[11px] text-slate-400">{LABEL.role[user.role]}</span>
        </span>
        <ChevronDown className="size-4 text-slate-400" aria-hidden />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 overflow-hidden rounded-lg bg-white py-1 text-sm text-slate-700 shadow-xl ring-1 ring-slate-200">
          <div className="border-b border-slate-100 px-3 py-2 min-[1400px]:hidden">
            <div className="font-medium text-slate-900">{user.name}</div>
            <div className="text-xs text-slate-500">{LABEL.role[user.role]}</div>
          </div>
          <Link href="/people?id=me" onClick={() => setOpen(false)} className="flex w-full items-center gap-2 px-3 py-2 hover:bg-slate-50">
            <UserRound className="size-4" aria-hidden /> My activity and location
          </Link>
          {isAdmin && (
            <Link href="/admin" onClick={() => setOpen(false)} className="flex w-full items-center gap-2 px-3 py-2 hover:bg-slate-50">
              <ShieldCheck className="size-4" aria-hidden /> Users, roles and alert settings
            </Link>
          )}
          <button type="button" onClick={reset} className="flex w-full items-center gap-2 px-3 py-2 hover:bg-slate-50">
            <RotateCcw className="size-4" aria-hidden /> Reset demo data
          </button>
          <button
            type="button"
            onClick={() => {
              signOut();
              onSignOut();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 hover:bg-slate-50"
          >
            <LogOut className="size-4" aria-hidden /> Sign out / switch account
          </button>
        </div>
      )}
    </div>
  );
}
