"use client";

import { useCallback, useEffect, useState } from "react";

import type { PrinterAction, PrinterSnapshot } from "@/lib/bambuddy";
import { formatPrintTime, formatTemplate, type Dictionary } from "@/lib/i18n/translations";

const POLL_INTERVAL_MS = 5000;

function temperature(current: number | null, target: number | null): string {
  if (current == null) return "—";
  return target ? `${Math.round(current)} / ${Math.round(target)}°C` : `${Math.round(current)}°C`;
}

function PrinterCard({
  printer,
  dict,
  onChanged,
}: {
  printer: PrinterSnapshot;
  dict: Dictionary;
  onChanged: () => void;
}) {
  const t = dict.admin;
  const [busy, setBusy] = useState<PrinterAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const state = printer.connected ? (printer.state ?? "IDLE") : "OFFLINE";
  const stateLabel = t.printerStates[state as keyof typeof t.printerStates] ?? state;
  const isPrinting = state === "RUNNING" || state === "PREPARE" || state === "SLICING";
  const isPaused = state === "PAUSE";
  const hasJob = isPrinting || isPaused;

  const run = async (action: PrinterAction) => {
    if (action === "stop" && !window.confirm(t.printerConfirmStop.replace("%s", printer.name))) return;
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/admin/printers/${printer.id}/${action}`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? t.printerActionError);
      }
      onChanged();
    } catch {
      setError(t.printerActionError);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-text">{printer.name}</div>
          {printer.model && <div className="text-xs text-muted">{printer.model}</div>}
        </div>
        <span className={`text-sm ${state === "FAILED" || state === "OFFLINE" ? "text-danger" : "text-accent"}`}>
          {stateLabel}
        </span>
      </div>

      {hasJob && (
        <div>
          <div className="truncate text-sm text-text" title={printer.job ?? undefined}>
            {printer.job ?? "—"}
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
            <div className="h-full bg-accent transition-all" style={{ width: `${printer.progress ?? 0}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-xs text-muted">
            <span>
              {Math.round(printer.progress ?? 0)}%
              {printer.totalLayers ? ` · ${t.printerLayer} ${printer.layer ?? 0}/${printer.totalLayers}` : ""}
            </span>
            {printer.remainingMinutes != null && (
              <span>
                {t.printerRemaining} {formatPrintTime(printer.remainingMinutes / 60, dict.units)}
              </span>
            )}
          </div>
        </div>
      )}

      {printer.connected && (
        <div className="flex gap-4 text-xs text-muted">
          <span>
            {t.printerNozzle}: <span className="text-text">{temperature(printer.nozzle, printer.nozzleTarget)}</span>
          </span>
          <span>
            {t.printerBed}: <span className="text-text">{temperature(printer.bed, printer.bedTarget)}</span>
          </span>
        </div>
      )}

      {printer.errors > 0 && <div className="text-xs text-danger">{formatTemplate(t.printerHmsErrors, printer.errors)}</div>}

      {hasJob && (
        <div className="flex gap-2">
          {isPaused ? (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => run("resume")}
              className="btn btn-primary px-3 py-1 text-xs"
            >
              {t.printerResume}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => run("pause")}
              className="btn btn-outline px-3 py-1 text-xs"
            >
              {t.printerPause}
            </button>
          )}
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => run("stop")}
            className="btn btn-outline px-3 py-1 text-xs text-danger"
          >
            {t.printerStop}
          </button>
        </div>
      )}

      {error && <div className="text-xs text-danger">{error}</div>}
    </div>
  );
}

export function PrintersAdmin({ dict }: { dict: Dictionary }) {
  const t = dict.admin;
  const [printers, setPrinters] = useState<PrinterSnapshot[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/printers", { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? t.printersError);
        return;
      }
      setPrinters(body.printers);
      setError(null);
    } catch {
      setError(t.printersError);
    }
  }, [t.printersError]);

  useEffect(() => {
    // Initial fetch + polling; setState happens after the await, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="text-sm text-danger">
          {t.printersError}: {error}
        </div>
      )}
      {printers === null && !error && <div className="text-sm text-muted">{t.printersLoading}</div>}
      {printers?.length === 0 && <div className="text-sm text-muted">{t.printersEmpty}</div>}
      {printers && printers.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {printers.map((printer) => (
            <PrinterCard key={printer.id} printer={printer} dict={dict} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}
