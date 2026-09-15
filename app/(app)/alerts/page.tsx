"use client";

import { useState } from "react";
import { AlertList } from "@/components/AlertList";
import { chipClass, chipRowClass } from "@/components/ui";
import { LABEL } from "@/lib/format";
import { useData } from "@/lib/hooks";
import { AlertType } from "@/lib/types";

type Show = "OPEN" | "ACKNOWLEDGED" | "ALL";

export default function AlertsPage() {
  const s = useData();
  const [show, setShow] = useState<Show>("OPEN");
  const [type, setType] = useState<AlertType | "ALL">("ALL");

  const open = s.alerts.filter((a) => !a.acknowledged).length;
  const alerts = s.alerts
    .filter((a) => (show === "ALL" ? true : show === "OPEN" ? !a.acknowledged : a.acknowledged))
    .filter((a) => type === "ALL" || a.type === type)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <header>
        <h1 className="text-lg font-semibold text-slate-900">Alerts</h1>
        <p className="text-sm text-slate-500">
          Raised automatically: a manifest that doesn&apos;t reconcile at closure, a vehicle more than 2 km off its route, an unscheduled stop,
          crew leaving a vehicle or walking away from it, or a loaded asset&apos;s RFID tag going quiet.
        </p>
      </header>
      <div className={chipRowClass}>
        {(["OPEN", "ACKNOWLEDGED", "ALL"] as const).map((v) => (
          <button key={v} type="button" className={chipClass(show === v)} onClick={() => setShow(v)}>
            {v === "OPEN" ? `Open (${open})` : v === "ACKNOWLEDGED" ? "Acknowledged" : "All"}
          </button>
        ))}
      </div>
      <div className={chipRowClass}>
        {(["ALL", ...Object.values(AlertType)] as const).map((v) => (
          <button key={v} type="button" className={chipClass(type === v)} onClick={() => setType(v)}>
            {v === "ALL" ? "Every type" : LABEL.alertType[v]}
          </button>
        ))}
      </div>
      <AlertList alerts={alerts} emptyText={show === "OPEN" ? "No open alerts." : "Nothing matches these filters."} />
    </div>
  );
}
