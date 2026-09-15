"use client";

import { MapPin, Search, X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { CustodyTimeline } from "@/components/CustodyTimeline";
import type { MiniMapLine, MiniMapPoint } from "@/components/MiniMap";
import { ASSET_STATE_TONE, Badge, chipClass, chipRowClass, CUSTODY_COLOR, cx, Empty, inputClass } from "@/components/ui";
import { LABEL, sastDateTime, timeAgo } from "@/lib/format";
import { useData } from "@/lib/hooks";
import { toLngLat } from "@/lib/rules";
import { assetEvents, assetLocation, assetMapHref, assetPosition, byTypeThenSerial, find, tripPings } from "@/lib/selectors";
import { AssetState, AssetType, TripState, type Asset, type CustodyEvent } from "@/lib/types";
import { formatTag } from "@/lib/validate";

const MiniMap = dynamic(() => import("@/components/MiniMap").then((m) => m.MiniMap), {
  ssr: false,
  loading: () => <div className="h-56 animate-pulse rounded-lg bg-slate-100" />,
});

export default function AssetsPage() {
  return (
    <Suspense>
      <AssetsScreen />
    </Suspense>
  );
}

function AssetsScreen() {
  const s = useData();
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState("");
  const [type, setType] = useState<AssetType | "ALL">("ALL");
  const [state, setState] = useState<AssetState | "ALL">("ALL");

  const lastEvent = useMemo(() => {
    const latest = new Map<string, CustodyEvent>();
    for (const e of s.custodyEvents) latest.set(e.assetId, e);
    return latest;
  }, [s.custodyEvents]);

  const q = query.trim().toUpperCase();
  const rows = s.assets
    .filter((a) => (type === "ALL" || a.type === type) && (state === "ALL" || a.state === state) && (!q || a.serial.includes(q)))
    .sort(byTypeThenSerial);
  const selected = s.assets.find((a) => a.serial === params.get("asset"));
  const open = (a: Asset) => router.replace(`/assets?asset=${encodeURIComponent(a.serial)}`, { scroll: false });
  const close = () => router.replace("/assets", { scroll: false });

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Assets</h1>
          <p className="text-sm text-slate-500">
            {s.assets.length} tracked items. Select one for its custody chain and map; select a location to see it on the main map.
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            className={cx(inputClass, "pl-9 font-mono uppercase")}
            placeholder="Search serial"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search by serial"
          />
        </div>
      </header>

      <div className="space-y-2 sm:flex sm:flex-wrap sm:gap-2 sm:space-y-0">
        <div className={chipRowClass}>
          {(["ALL", AssetType.VMD, AssetType.BALLOT_BOX, AssetType.BALLOT_PAPERS] as const).map((t) => (
            <button key={t} type="button" className={chipClass(type === t)} onClick={() => setType(t)}>
              {t === "ALL" ? "Every type" : LABEL.assetType[t]}
            </button>
          ))}
        </div>
        <span className="hidden w-px bg-slate-300 sm:block" />
        <div className={chipRowClass}>
          {(["ALL", ...Object.values(AssetState)] as const).map((st) => (
            <button key={st} type="button" className={chipClass(state === st)} onClick={() => setState(st)}>
              {st === "ALL" ? "Every state" : LABEL.assetState[st]}{" "}
              <span className="opacity-60">{st === "ALL" ? s.assets.length : s.assets.filter((a) => a.state === st).length}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        {rows.length === 0 ? (
          <div className="p-4">
            <Empty title="No assets match these filters" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Serial</th>
                <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Type</th>
                <th className="px-4 py-2.5 font-medium">State</th>
                <th className="hidden px-4 py-2.5 font-medium md:table-cell">Location</th>
                <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Last hand-off</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((a) => {
                const last = lastEvent.get(a.id);
                return (
                  <tr key={a.id} onClick={() => open(a)} className="cursor-pointer hover:bg-slate-50">
                    {/* On phones this cell takes the spare width and truncates the location, so the state badge stays in view. */}
                    <td className="px-4 py-2.5 max-md:w-full max-md:max-w-0">
                      <button type="button" onClick={() => open(a)} className="font-mono font-medium text-slate-900 hover:underline">
                        {a.serial}
                      </button>
                      <div className="md:hidden">
                        <LocationLink asset={a} compact />
                      </div>
                    </td>
                    <td className="hidden px-4 py-2.5 text-slate-600 sm:table-cell">{LABEL.assetType[a.type]}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={ASSET_STATE_TONE[a.state]}>{LABEL.assetState[a.state]}</Badge>
                    </td>
                    <td className="hidden max-w-xs px-4 py-2.5 md:table-cell">
                      <LocationLink asset={a} />
                    </td>
                    <td className="hidden px-4 py-2.5 text-slate-600 lg:table-cell">
                      {last ? (
                        <>
                          {LABEL.custody[last.type]} · <span className="text-slate-500">{sastDateTime(last.createdAt)}</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {selected && <AssetDrawer asset={selected} onClose={close} />}
    </div>
  );
}

/** The asset's location, linking to the main map framed on that facility or vehicle. */
function LocationLink({ asset, compact }: { asset: Asset; compact?: boolean }) {
  const s = useData();
  const where = assetLocation(s, asset);
  const href = assetMapHref(asset);
  return (
    <div className="min-w-0">
      {href ? (
        <Link
          href={href}
          onClick={(e) => e.stopPropagation()}
          className={cx("inline-flex max-w-full items-center gap-1 text-blue-700 hover:underline", compact && "text-xs")}
          title="Show on the map"
        >
          <MapPin className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{where.label}</span>
        </Link>
      ) : (
        <span className={cx("text-slate-500", compact && "text-xs")}>{where.label}</span>
      )}
      {where.detail && !compact && <div className="truncate text-xs text-slate-500">{where.detail}</div>}
    </div>
  );
}

function AssetDrawer({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const s = useData();
  const events = assetEvents(s, asset.id);
  const now = assetPosition(s, asset);
  const trip = asset.state === AssetState.IN_TRANSIT ? find(s.trips, asset.currentTripId) : undefined;
  const vehicle = trip ? find(s.vehicles, trip.vehicleId) : undefined;
  const reading = vehicle?.onboard && trip?.state !== TripState.PLANNED ? vehicle.onboard : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Keep the list behind the drawer from scrolling under your finger.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  // Numbered dots where each hand-off was scanned, a big "Now" dot, and the trip it's on.
  const points: MiniMapPoint[] = [
    ...events.map((e, i) => ({ lat: e.lat, lng: e.lng, color: CUSTODY_COLOR[e.type], label: String(i + 1), radius: 5 })),
    ...(now ? [{ lat: now.lat, lng: now.lng, color: asset.state === AssetState.IN_TRANSIT ? "#2563eb" : "#0f172a", label: "Now", radius: 8 }] : []),
  ];
  const lines: MiniMapLine[] = [
    { coordinates: events.map((e) => [e.lng, e.lat]), color: "#94a3b8", dashed: true, width: 2 },
    ...(trip
      ? [
          { coordinates: trip.plannedRoute.map(toLngLat), color: "#64748b", width: 3 },
          { coordinates: tripPings(s, trip.id).map((p) => [p.lng, p.lat]), color: "#2563eb", width: 3 },
        ]
      : []),
  ];

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={`Custody chain for ${asset.serial}`}>
      <button type="button" className="absolute inset-0 bg-slate-900/30" aria-label="Close" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-lg flex-col bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <p className="font-mono text-lg font-semibold text-slate-900">{asset.serial}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge>{LABEL.assetType[asset.type]}</Badge>
              <Badge tone={ASSET_STATE_TONE[asset.state]}>{LABEL.assetState[asset.state]}</Badge>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              RFID tag <span className="font-mono text-slate-700">{formatTag(asset.rfidTag)}</span>
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="size-5" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4 pb-24 md:pb-4">
          <section className="rounded-lg bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Now</p>
            <LocationLink asset={asset} />
            {reading && vehicle && (
              <p className={cx("mt-1 text-xs font-medium", reading.assetIds.includes(asset.id) ? "text-emerald-700" : "text-red-600")}>
                {reading.assetIds.includes(asset.id)
                  ? `Detected on board ${vehicle.registration} by its RFID reader, ${timeAgo(reading.readAt)}.`
                  : `Not detected by ${vehicle.registration}'s RFID reader on its latest read.`}
              </p>
            )}
          </section>

          {points.length > 0 && (
            <div className="mt-4">
              <MiniMap points={points} lines={lines} frameKey={asset.id} />
              <p className="mt-1.5 text-xs text-slate-500">Numbered dots are where each hand-off below was scanned.</p>
            </div>
          )}

          <h3 className="mb-3 mt-5 text-sm font-semibold text-slate-900">
            Custody chain · {events.length} record{events.length === 1 ? "" : "s"}
          </h3>
          <CustodyTimeline state={s} events={events} />
          <p className="mt-6 text-xs text-slate-400">
            Custody records are append-only: nothing here can be edited or deleted. A mistake is corrected by recording another hand-off.
          </p>
        </div>
      </div>
    </div>
  );
}
