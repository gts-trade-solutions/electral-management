"use client";

import { ArrowRight } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { Logo } from "@/components/AppShell";
import { Badge, Button, Field, inputClass } from "@/components/ui";
import { APP_NAME, APP_TAGLINE, EMAIL_DOMAIN } from "@/lib/brand";
import { LABEL } from "@/lib/format";
import { signIn, signInAs } from "@/lib/session";
import { loadDemo, useDemo } from "@/lib/store";
import { FIELD_PASSWORD, ROLE_SUMMARY } from "@/lib/users";

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}

function Login() {
  const router = useRouter();
  const params = useSearchParams();
  const state = useDemo();
  const next = params.get("next");
  const target = next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : "/map";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Accounts live in the demo data (the admin can add more), so load it first.
  useEffect(() => {
    loadDemo();
  }, []);

  const accounts = state?.users.filter((u) => u.active) ?? [];
  // Field staff carry RFID badges; the office accounts don't.
  const office = accounts.filter((u) => !u.rfidBadge);
  const field = accounts.filter((u) => u.rfidBadge);
  const signInAndGo = (id: string) => {
    signInAs(id);
    router.replace(target);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (signIn(email, password)) router.replace(target);
    else setError("That email and password don't match an active account.");
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-900 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center text-white">
          <Logo className="mx-auto size-12" />
          <h1 className="mt-2 text-2xl font-semibold tracking-wide">{APP_NAME}</h1>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-amber-400">{APP_TAGLINE}</p>
          <p className="mt-2 text-sm text-slate-400">
            Custody and transport tracking for electoral assets, vehicles and people
            <br />
            Local Government Elections · 4 November 2026
          </p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-xl">
          <h2 className="text-base font-semibold text-slate-900">Sign in to the demo</h2>
          <p className="mt-1 text-sm text-slate-500">Every role sees the same data but can do different things.</p>

          <div className="mt-4 space-y-2">
            {office.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => signInAndGo(u.id)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left ring-1 ring-slate-200 hover:bg-slate-50 hover:ring-slate-300"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-semibold text-white">
                  {u.name.split(" ").map((p) => p[0]).join("").slice(0, 2)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-medium text-slate-900">
                    {u.name} <Badge>{LABEL.role[u.role]}</Badge>
                  </span>
                  <span className="block truncate text-xs text-slate-500">{ROLE_SUMMARY[u.role]}</span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-slate-400" aria-hidden />
              </button>
            ))}
          </div>

          {field.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium text-slate-500">
                Field staff: drivers, escorts, SAPS and electoral officers (password <span className="font-mono">{FIELD_PASSWORD}</span>)
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {field.map((u) => {
                  const vehicle = state?.vehicles.find((v) => v.id === u.vehicleId);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => signInAndGo(u.id)}
                      className="rounded-lg px-3 py-2 text-left ring-1 ring-slate-200 hover:bg-slate-50 hover:ring-slate-300"
                    >
                      <span className="block truncate text-sm font-medium text-slate-900">{u.name}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {u.duty ? LABEL.crewRole[u.duty] : LABEL.role[u.role]} · {vehicle ? vehicle.registration : "no vehicle"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="my-5 flex items-center gap-3 text-xs text-slate-400">
            <span className="h-px flex-1 bg-slate-200" />
            or with email and password
            <span className="h-px flex-1 bg-slate-200" />
          </div>

          <form onSubmit={submit} className="space-y-3">
            <Field label="Email">
              <input
                className={inputClass}
                type="email"
                autoComplete="username"
                placeholder={`officer@${EMAIL_DOMAIN}`}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="Password">
              <input
                className={inputClass}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" className="w-full">
              Sign in
            </Button>
          </form>

          <p className="mt-5 text-xs leading-relaxed text-slate-500">
            Demo build: accounts are checked in your browser and every record stays on this device. Nothing is sent to a server.
          </p>
        </div>
      </div>
    </main>
  );
}
