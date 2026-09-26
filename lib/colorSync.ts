import { isBambuddyConfigured, listSpools, type BambuddySpool } from "@/lib/bambuddy";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { colorNameEn, colorNameRuFromHex } from "@/lib/i18n/colorNames";
import { getMinStockGrams, getSetting, setSetting } from "@/lib/settings";

// Colors offered to customers come from the Bambuddy spool inventory: every active spool is
// matched to one of our materials, spools of the same material/variant/color are summed up,
// and a color is shown while the total is at least the admin's "min stock" setting.
// Synced colors are never deleted (past orders reference them) — a color that ran out just
// gets stockGrams = 0 and disappears from the site until a new spool shows up.

const SYNC_INTERVAL_MS = 5 * 60 * 1000;
const RETRY_AFTER_FAILURE_MS = 60 * 1000;

export type ColorSyncResult = { spools: number; colors: number; skippedMaterials: string[] };

type MaterialToken = { id: string; token: string };

// First word of our material name: "PA (Nylon)" → "PA".
function materialToken(name: string): string {
  return name.trim().split(/[\s(]/)[0].toUpperCase();
}

/**
 * "PETG" → PETG; "ABS-CF15" → ABS with variant "ABS-CF15"; "PA6-CF" → PA.
 * A longer token wins (PETG before PET); "PAHT-CF" or "HIPS" match nothing and are skipped.
 */
function matchMaterial(bambuddyMaterial: string, tokens: MaterialToken[]) {
  const label = bambuddyMaterial.trim();
  const value = label.toUpperCase();
  for (const { id, token } of tokens) {
    if (value === token) return { materialId: id, variant: "" };
    if (value.startsWith(token) && !/[A-Z]/.test(value[token.length])) return { materialId: id, variant: label };
  }
  return null;
}

function spoolColor(spool: BambuddySpool) {
  const rgba = spool.rgba && /^[0-9a-f]{8}$/i.test(spool.rgba) ? spool.rgba.toLowerCase() : "888888ff";
  const hex = `#${rgba.slice(0, 6)}`;
  const given = spool.color_name?.trim();
  if (given) {
    // Names typed in Russian get an English canonical name, like colors added in the admin.
    return /[а-яё]/i.test(given) ? { name: colorNameEn(given), nameRu: given, hex } : { name: given, nameRu: null, hex };
  }
  const nameRu = colorNameRuFromHex(hex, parseInt(rgba.slice(6), 16));
  return { name: colorNameEn(nameRu), nameRu, hex };
}

export async function syncColorsFromBambuddy(): Promise<ColorSyncResult> {
  try {
    const [spools, materials] = await Promise.all([
      listSpools(),
      prisma.material.findMany({ select: { id: true, name: true } }),
    ]);
    const tokens = materials
      .map((m) => ({ id: m.id, token: materialToken(m.name) }))
      .sort((a, b) => b.token.length - a.token.length);

    type Group = { materialId: string; variant: string; name: string; nameRu: string | null; hex: string; externalKey: string; grams: number; topGrams: number };
    const groups = new Map<string, Group>();
    const skipped = new Set<string>();
    for (const spool of spools) {
      const match = matchMaterial(spool.material, tokens);
      if (!match) {
        skipped.add(spool.material.trim());
        continue;
      }
      const color = spoolColor(spool);
      const grams = Math.max(0, Math.round(spool.label_weight - spool.weight_used));
      const externalKey = `${match.variant}|${color.name}`;
      const key = `${match.materialId}|${externalKey}`;
      const group = groups.get(key);
      if (!group) {
        groups.set(key, { ...match, ...color, externalKey, grams, topGrams: grams });
      } else {
        group.grams += grams;
        // The fullest spool decides the shade shown on the site.
        if (grams > group.topGrams) {
          group.topGrams = grams;
          group.hex = color.hex;
        }
      }
    }

    const seen: string[] = [];
    for (const g of groups.values()) {
      const byKey = await prisma.color.findUnique({
        where: { materialId_externalKey: { materialId: g.materialId, externalKey: g.externalKey } },
      });
      // A manually added color with the same name is adopted — it keeps its Russian name and price.
      const row =
        byKey ??
        (await prisma.color.findUnique({
          where: { materialId_variant_name: { materialId: g.materialId, variant: g.variant, name: g.name } },
        }));
      if (row) {
        await prisma.color.update({
          where: { id: row.id },
          data: { source: "bambuddy", stockGrams: g.grams, ...(row.externalKey ? {} : { externalKey: g.externalKey }) },
        });
        seen.push(row.id);
      } else {
        // Upsert, not create: a sync running at the same moment (another server process) may
        // have just created this very color — then it is simply updated.
        const saved = await prisma.color.upsert({
          where: { materialId_variant_name: { materialId: g.materialId, variant: g.variant, name: g.name } },
          update: { source: "bambuddy", stockGrams: g.grams },
          create: {
            materialId: g.materialId,
            variant: g.variant,
            name: g.name,
            nameRu: g.nameRu,
            hex: g.hex,
            source: "bambuddy",
            externalKey: g.externalKey,
            stockGrams: g.grams,
          },
        });
        seen.push(saved.id);
      }
    }

    await prisma.color.updateMany({ where: { source: "bambuddy", id: { notIn: seen } }, data: { stockGrams: 0 } });
    await setSetting("bambuddy.lastSyncAt", new Date().toISOString());
    await setSetting("bambuddy.lastSyncError", "");
    return { spools: spools.length, colors: groups.size, skippedMaterials: [...skipped].sort() };
  } catch (err) {
    await setSetting("bambuddy.lastSyncError", err instanceof Error ? err.message : String(err)).catch(() => {});
    throw err;
  }
}

// On globalThis, not module scope: Next bundles pages and API routes separately, and each
// bundle gets its own copy of this module — a module-level guard let them sync in parallel.
const state = globalThis as typeof globalThis & {
  colorSyncRunning?: Promise<void> | null;
  colorSyncLastAttemptAt?: number;
};

/**
 * Re-syncs when the last sync is older than 5 minutes. Only the very first sync is awaited;
 * after that the page renders with the colors it has and the sync finishes in the background,
 * so a slow or stopped Bambuddy never slows the site down.
 */
export async function ensureColorsFresh(): Promise<void> {
  if (!isBambuddyConfigured()) return;
  // Claimed synchronously, before any await, so parallel requests share one check/sync.
  state.colorSyncRunning ??= (async () => {
    const now = Date.now();
    const lastSyncAt = Date.parse(await getSetting("bambuddy.lastSyncAt")) || 0;
    if (now - lastSyncAt < SYNC_INTERVAL_MS) return;
    // Bambuddy was unreachable a moment ago — don't hit it on every request.
    if (now - (state.colorSyncLastAttemptAt ?? 0) < RETRY_AFTER_FAILURE_MS) return;
    state.colorSyncLastAttemptAt = now;
    await syncColorsFromBambuddy();
  })()
    .catch((err) => console.error("[colorSync]", err instanceof Error ? err.message : err))
    .finally(() => {
      state.colorSyncRunning = null;
    });
  const running = state.colorSyncRunning;
  // Only the very first sync is waited for; later ones refresh in the background.
  if (!(await getSetting("bambuddy.lastSyncAt"))) await running;
}

/**
 * Which colors customers may pick. Until Bambuddy is set up and synced at least once the
 * manually added colors are used as before; after that only synced colors that are in stock.
 */
export async function availableColorsWhere(): Promise<Prisma.ColorWhereInput> {
  await ensureColorsFresh();
  const { inventoryDriven, minStockGrams } = await getColorAvailability();
  if (!inventoryDriven) return {};
  return { source: "bambuddy", stockGrams: { gte: minStockGrams } };
}

/**
 * What customers may order: colors as in availableColorsWhere(), and materials that are active
 * and — once colors come from the Bambuddy inventory — have at least one of those colors.
 * A material with nothing in stock is not offered at all.
 */
export async function availableCatalog(): Promise<{
  colors: Prisma.ColorWhereInput;
  materials: Prisma.MaterialWhereInput;
}> {
  const colors = await availableColorsWhere();
  const inventoryDriven = Object.keys(colors).length > 0;
  return { colors, materials: { active: true, ...(inventoryDriven ? { colors: { some: colors } } : {}) } };
}

/** The same rule as availableColorsWhere(), for marking colors in the admin. */
export async function getColorAvailability() {
  const inventoryDriven = isBambuddyConfigured() && Boolean(await getSetting("bambuddy.lastSyncAt"));
  return { inventoryDriven, minStockGrams: await getMinStockGrams() };
}

export function isColorAvailable(
  color: { source: string; stockGrams: number | null },
  rule: { inventoryDriven: boolean; minStockGrams: number },
): boolean {
  if (!rule.inventoryDriven) return true;
  return color.source === "bambuddy" && (color.stockGrams ?? 0) >= rule.minStockGrams;
}
