import { prisma } from "@/lib/db";

// Admin-editable settings (the Setting table), each with its default.
const DEFAULTS = {
  /** A synced Bambuddy color is offered to customers only with at least this many grams left. */
  "bambuddy.minStockGrams": "100",
  /** ISO time of the last successful color sync from Bambuddy ("" = never). */
  "bambuddy.lastSyncAt": "",
  /** Error of the last failed sync ("" = the last attempt succeeded). */
  "bambuddy.lastSyncError": "",
  /** Slicer infill levels (%) customers pick from, and the one preselected. */
  "order.infillLevels": "15,25,50,100",
  "order.defaultInfill": "25",
} as const;

export type SettingKey = keyof typeof DEFAULTS;

export async function getSettings<K extends SettingKey>(keys: K[]): Promise<Record<K, string>> {
  const rows = await prisma.setting.findMany({ where: { key: { in: keys } } });
  const values = {} as Record<K, string>;
  for (const key of keys) values[key] = DEFAULTS[key];
  for (const row of rows) values[row.key as K] = row.value;
  return values;
}

export async function getSetting(key: SettingKey): Promise<string> {
  return (await getSettings([key]))[key];
}

export async function setSetting(key: SettingKey, value: string): Promise<void> {
  await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

/** Sorted infill levels in 1-100 and the default one (always one of the levels). */
export async function getInfillOptions(): Promise<{ levels: number[]; defaultLevel: number }> {
  const values = await getSettings(["order.infillLevels", "order.defaultInfill"]);
  const parse = (raw: string) =>
    [...new Set(raw.split(/[,\s]+/).map(Number))].filter((n) => Number.isInteger(n) && n >= 1 && n <= 100).sort((a, b) => a - b);
  let levels = parse(values["order.infillLevels"]);
  if (levels.length === 0) levels = parse(DEFAULTS["order.infillLevels"]);
  const wanted = Number(values["order.defaultInfill"]);
  // The closest level, so a removed default still resolves to something the customer can pick.
  const defaultLevel = levels.reduce((best, n) => (Math.abs(n - wanted) < Math.abs(best - wanted) ? n : best), levels[0]);
  return { levels, defaultLevel };
}

export async function getMinStockGrams(): Promise<number> {
  const n = Number(await getSetting("bambuddy.minStockGrams"));
  return Number.isFinite(n) && n >= 0 ? n : Number(DEFAULTS["bambuddy.minStockGrams"]);
}
