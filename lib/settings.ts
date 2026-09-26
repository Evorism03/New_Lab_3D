import { prisma } from "@/lib/db";

// Admin-editable settings (the Setting table), each with its default.
const DEFAULTS = {
  /** A synced Bambuddy color is offered to customers only with at least this many grams left. */
  "bambuddy.minStockGrams": "100",
  /** ISO time of the last successful color sync from Bambuddy ("" = never). */
  "bambuddy.lastSyncAt": "",
  /** Error of the last failed sync ("" = the last attempt succeeded). */
  "bambuddy.lastSyncError": "",
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

export async function getMinStockGrams(): Promise<number> {
  const n = Number(await getSetting("bambuddy.minStockGrams"));
  return Number.isFinite(n) && n >= 0 ? n : Number(DEFAULTS["bambuddy.minStockGrams"]);
}
