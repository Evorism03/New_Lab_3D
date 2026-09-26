// Bambuddy (github.com/maziggy/bambuddy) runs on the same machine as a Windows service and
// talks to the Bambu printers over LAN. We only call its REST API from the server, so the
// API key (Bambuddy → Settings → API Keys, needs printers:read + printers:control) never
// reaches the browser.
const BAMBUDDY_URL = (process.env.BAMBUDDY_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const BAMBUDDY_API_KEY = process.env.BAMBUDDY_API_KEY;
const REQUEST_TIMEOUT_MS = 5000;

export const PRINTER_ACTIONS = ["pause", "resume", "stop"] as const;
export type PrinterAction = (typeof PRINTER_ACTIONS)[number];

export type PrinterSnapshot = {
  id: number;
  name: string;
  model: string | null;
  connected: boolean;
  state: string | null;
  job: string | null;
  progress: number | null;
  remainingMinutes: number | null;
  layer: number | null;
  totalLayers: number | null;
  nozzle: number | null;
  nozzleTarget: number | null;
  bed: number | null;
  bedTarget: number | null;
  errors: number;
};

export class BambuddyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function callBambuddy<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!BAMBUDDY_API_KEY) throw new BambuddyError("BAMBUDDY_API_KEY is not configured", 503);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BAMBUDDY_URL}/api/v1${path}`, {
      ...init,
      headers: { "X-API-Key": BAMBUDDY_API_KEY, ...init.headers },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const detail = typeof body?.detail === "string" ? body.detail : res.statusText;
      throw new BambuddyError(detail, res.status);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof BambuddyError) throw err;
    throw new BambuddyError(`Bambuddy is unreachable at ${BAMBUDDY_URL}`, 502);
  } finally {
    clearTimeout(timeout);
  }
}

type BambuddyPrinter = { id: number; name: string; model: string | null; is_active: boolean };
type BambuddyStatus = {
  connected: boolean;
  state: string | null;
  subtask_name: string | null;
  current_print: string | null;
  progress: number | null;
  remaining_time: number | null;
  layer_num: number | null;
  total_layers: number | null;
  temperatures: Record<string, number> | null;
  hms_errors: unknown[];
};

export async function listPrinters(): Promise<PrinterSnapshot[]> {
  const printers = (await callBambuddy<BambuddyPrinter[]>("/printers/")).filter((p) => p.is_active);
  return Promise.all(
    printers.map(async (printer): Promise<PrinterSnapshot> => {
      // One unreachable printer must not hide the others.
      const status = await callBambuddy<BambuddyStatus>(`/printers/${printer.id}/status`).catch(() => null);
      const temps = status?.temperatures ?? {};
      return {
        id: printer.id,
        name: printer.name,
        model: printer.model,
        connected: status?.connected ?? false,
        state: status?.state ?? null,
        job: status?.subtask_name || status?.current_print || null,
        progress: status?.progress ?? null,
        remainingMinutes: status?.remaining_time ?? null,
        layer: status?.layer_num ?? null,
        totalLayers: status?.total_layers ?? null,
        nozzle: temps.nozzle ?? null,
        nozzleTarget: temps.nozzle_target ?? null,
        bed: temps.bed ?? null,
        bedTarget: temps.bed_target ?? null,
        errors: status?.hms_errors?.length ?? 0,
      };
    }),
  );
}

const ACTION_PATHS: Record<PrinterAction, string> = {
  pause: "print/pause",
  resume: "print/resume",
  stop: "print/stop",
};

export async function controlPrinter(printerId: number, action: PrinterAction): Promise<void> {
  await callBambuddy(`/printers/${printerId}/${ACTION_PATHS[action]}`, { method: "POST" });
}

// Public address of the Bambuddy web UI for the "open Bambuddy" link. BAMBUDDY_PUBLIC_URL
// wins; otherwise bambu.<site domain>, which is what deploy/setup.ps1 registers in Caddy.
export function getBambuddyPublicUrl(): string {
  if (process.env.BAMBUDDY_PUBLIC_URL) return process.env.BAMBUDDY_PUBLIC_URL.replace(/\/$/, "");
  const app = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  try {
    const url = new URL(app);
    const isLocal = url.hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname);
    if (isLocal) return `http://${url.hostname}:8000`;
    return `${url.protocol}//bambu.${url.hostname.replace(/^www\./, "")}`;
  } catch {
    return "http://localhost:8000";
  }
}
