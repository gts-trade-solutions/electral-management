"use client";

import { Camera, CircleCheck, ScanLine } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useRef, useState, type FormEvent } from "react";
import { BarcodeScanner, useCanScanBarcodes } from "@/components/BarcodeScanner";
import { useHandoffGps } from "@/components/GpsStatus";
import { ASSET_STATE_TONE, Badge, Button, Card, CUSTODY_TONE, cx, Field, inputClass } from "@/components/ui";
import { recordCustody } from "@/lib/domain";
import { LABEL, sastTime } from "@/lib/format";
import { execute, useCan, useData, useUser } from "@/lib/hooks";
import { assetLocation, find, handoffOptions, loadSeal, plannedTripsFrom, tripParts } from "@/lib/selectors";
import { toast } from "@/lib/toast";
import { AssetState, CustodyEventType, FacilityType, type CustodyEvent } from "@/lib/types";

export default function ScanPage() {
  return (
    <Suspense>
      <ScanScreen />
    </Suspense>
  );
}

function ScanScreen() {
  const s = useData();
  const user = useUser();
  const allowed = useCan()("recordCustody");
  const params = useSearchParams();
  const canUseCamera = useCanScanBarcodes();
  const serialInput = useRef<HTMLInputElement>(null);

  const [serial, setSerial] = useState(params.get("serial") ?? "");
  const [type, setType] = useState<CustodyEventType | null>(null);
  const [tripId, setTripId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  // Kept between scans: a crate of VMDs shares one seal.
  const [seal, setSeal] = useState("");
  const [camera, setCamera] = useState(false);
  const [recent, setRecent] = useState<CustodyEvent[]>([]);

  const key = serial.trim().toUpperCase();
  const asset = key ? s.assets.find((a) => a.serial === key) : undefined;
  const options = asset ? handoffOptions(s, asset) : [];
  const usable = options.filter((o) => !o.disabledReason);
  // Keep the chosen hand-off while it still applies; never default to "report missing".
  const option = usable.find((o) => o.type === type) ?? usable.find((o) => o.type !== CustodyEventType.REPORT_MISSING) ?? null;

  const loadTrips = option?.type === CustodyEventType.LOAD && asset ? plannedTripsFrom(s, asset.currentFacilityId) : [];
  const loadTrip = find(loadTrips, tripId) ?? find(loadTrips, asset?.currentTripId) ?? loadTrips[0];
  const receiveTrip = option?.type === CustodyEventType.RECEIVE ? find(s.trips, asset?.currentTripId) : undefined;
  const warehouses = s.facilities.filter((f) => f.type === FacilityType.WAREHOUSE);
  const intakeWarehouse = find(warehouses, warehouseId) ?? warehouses[0];
  const expectedSeal = receiveTrip && asset ? loadSeal(s, asset.id, receiveTrip.id) : null;
  const needsSeal = option?.type === CustodyEventType.LOAD || option?.type === CustodyEventType.RECEIVE;
  const sealDiffers = !!expectedSeal && !!seal.trim() && seal.trim().toUpperCase() !== expectedSeal;

  // Where the hand-off happens, for the flagged no-GPS fallback.
  const place =
    option?.type === CustodyEventType.LOAD
      ? find(s.facilities, loadTrip?.originFacilityId)
      : option?.type === CustodyEventType.RECEIVE
        ? find(s.facilities, receiveTrip?.destFacilityId)
        : option?.type === CustodyEventType.INTAKE
          ? intakeWarehouse
          : find(s.facilities, asset?.currentFacilityId);
  const gps = useHandoffGps(place ?? null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!asset || !option) return;
    const fix = gps.fix;
    if (!fix) {
      toast.error("Waiting for a GPS fix: every hand-off records where it happened.");
      return;
    }
    const result = execute(
      (st) =>
        recordCustody(
          st,
          user,
          {
            assetId: asset.id,
            type: option.type,
            tripId: loadTrip?.id ?? null,
            toFacilityId: intakeWarehouse?.id ?? null,
            sealNumber: seal,
            gps: fix,
          },
          new Date(),
        ),
      `${LABEL.custody[option.type]}: ${asset.serial}`,
    );
    if (result) {
      setRecent((prev) => [result.event, ...prev].slice(0, 10));
      setSerial("");
      serialInput.current?.focus();
    }
  };

  const where = asset ? assetLocation(s, asset) : null;

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <header>
        <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          <ScanLine className="size-5" aria-hidden /> Record a hand-off
        </h1>
        <p className="text-sm text-slate-500">
          Scan or type a serial, choose the hand-off, confirm the seal. Each record stores your name, the time and where this device is.
        </p>
      </header>

      {!allowed && (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
          Your role ({LABEL.role[user.role].toLowerCase()}) can&apos;t record hand-offs, but you can still look assets up here. An admin can
          change what roles may do.
        </div>
      )}

      {gps.status}

      <form onSubmit={submit} className="space-y-4">
        <Card>
          <Field label="Asset serial">
            <div className="flex gap-2">
              <input
                ref={serialInput}
                className={cx(inputClass, "h-12 font-mono text-base uppercase")}
                value={serial}
                onChange={(e) => setSerial(e.target.value)}
                placeholder="VMD-GP-0011"
                list="asset-serials"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                autoFocus
              />
              {canUseCamera && (
                <Button variant="secondary" size="lg" onClick={() => setCamera(true)} aria-label="Scan with the camera">
                  <Camera className="size-5" />
                </Button>
              )}
            </div>
          </Field>
          <datalist id="asset-serials">
            {s.assets.map((a) => (
              <option key={a.id} value={a.serial} />
            ))}
          </datalist>

          {key && !asset && <p className="mt-2 text-sm text-red-600">No asset has the serial {key}.</p>}
          {asset && where && (
            <div className="mt-3 rounded-lg bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-semibold text-slate-900">{asset.serial}</span>
                <Badge>{LABEL.assetType[asset.type]}</Badge>
                <Badge tone={ASSET_STATE_TONE[asset.state]}>{LABEL.assetState[asset.state]}</Badge>
              </div>
              <p className="mt-1 text-sm text-slate-700">{where.label}</p>
              {where.detail && <p className="text-xs text-slate-500">{where.detail}</p>}
              <Link href={`/assets?asset=${encodeURIComponent(asset.serial)}`} className="mt-1 inline-block text-xs font-medium text-blue-700 hover:underline">
                View custody chain
              </Link>
            </div>
          )}
        </Card>

        {asset && (
          <Card title="Hand-off">
            <div className="space-y-2" role="radiogroup" aria-label="Hand-off type">
              {options.map((o) => {
                const active = option?.type === o.type;
                return (
                  <button
                    key={o.type}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={!!o.disabledReason}
                    onClick={() => setType(o.type)}
                    className={cx(
                      "flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left ring-1 ring-inset disabled:cursor-not-allowed disabled:opacity-50",
                      active ? "bg-slate-900 text-white ring-slate-900" : "ring-slate-300 hover:bg-slate-50",
                    )}
                  >
                    <span className={cx("mt-1 size-3 shrink-0 rounded-full ring-2", active ? "bg-amber-400 ring-amber-400" : "ring-slate-300")} />
                    <span>
                      <span className="block text-sm font-medium">{o.label}</span>
                      <span className={cx("block text-xs", active ? "text-slate-300" : "text-slate-500")}>{o.disabledReason ?? o.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {option?.type === CustodyEventType.LOAD && loadTrip && (
              <div className="mt-4 space-y-2">
                {loadTrips.length > 1 ? (
                  <Field label="Trip">
                    <select className={inputClass} value={loadTrip.id} onChange={(e) => setTripId(e.target.value)}>
                      {loadTrips.map((t) => {
                        const p = tripParts(s, t);
                        return (
                          <option key={t.id} value={t.id}>
                            {p.vehicle.registration} → {p.destination.name}
                          </option>
                        );
                      })}
                    </select>
                  </Field>
                ) : (
                  <p className="text-sm text-slate-600">
                    Onto <strong>{tripParts(s, loadTrip).vehicle.registration}</strong>, bound for {tripParts(s, loadTrip).destination.name}.
                  </p>
                )}
                {asset.currentTripId !== loadTrip.id && (
                  <p className="text-xs text-amber-700">Not picked for this trip. Loading it adds it to the manifest.</p>
                )}
              </div>
            )}

            {option?.type === CustodyEventType.RECEIVE && receiveTrip && (
              <p className="mt-4 text-sm text-slate-600">
                Off <strong>{tripParts(s, receiveTrip).vehicle.registration}</strong> into {tripParts(s, receiveTrip).destination.name}.
              </p>
            )}

            {option?.type === CustodyEventType.INTAKE && (
              <div className="mt-4">
                <Field label="Into warehouse">
                  <select className={inputClass} value={intakeWarehouse?.id ?? ""} onChange={(e) => setWarehouseId(e.target.value)}>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            )}

            {option?.type === CustodyEventType.REPORT_MISSING && (
              <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800 ring-1 ring-inset ring-red-200">
                This records, under your name, that {asset.serial} can&apos;t be found. Its location becomes unknown
                {asset.state === AssetState.IN_TRANSIT ? ", and its trip can't close until it is received." : "."}
              </p>
            )}

            {needsSeal && (
              <div className="mt-4">
                <Field label="Seal number" hint={expectedSeal ? `It was loaded with seal ${expectedSeal}.` : "The seal on this asset or its crate."}>
                  <input
                    className={cx(inputClass, "h-11 font-mono uppercase", sealDiffers && "ring-2 ring-red-400")}
                    value={seal}
                    onChange={(e) => setSeal(e.target.value)}
                    placeholder={expectedSeal ?? "SL-300001"}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </Field>
                {sealDiffers && (
                  <p className="mt-1 text-xs font-medium text-red-600">
                    This isn&apos;t the seal it was loaded with ({expectedSeal}). Record what you actually see.
                  </p>
                )}
              </div>
            )}

            <Button
              type="submit"
              size="lg"
              className="mt-4 w-full"
              disabled={!allowed || !option || !gps.fix || (needsSeal && !seal.trim())}
            >
              {option ? option.label : "Choose a hand-off"}
            </Button>
          </Card>
        )}
      </form>

      {recent.length > 0 && (
        <Card title="Recorded on this screen" flush>
          <ul className="divide-y divide-slate-100">
            {recent.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <CircleCheck className="size-4 text-emerald-600" aria-hidden />
                <span className="font-mono">{find(s.assets, e.assetId)?.serial}</span>
                <Badge tone={CUSTODY_TONE[e.type]}>{LABEL.custody[e.type]}</Badge>
                <span className="ml-auto text-xs text-slate-500">{sastTime(e.createdAt)} SAST</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {camera && (
        <BarcodeScanner
          onDetected={(value) => {
            setSerial(value.toUpperCase());
            setCamera(false);
          }}
          onClose={() => setCamera(false)}
        />
      )}
    </div>
  );
}
