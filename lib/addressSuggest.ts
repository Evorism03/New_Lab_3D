// Address suggestions for checkout: city → street → house, each narrowed to the previous choice.
// DaData (DADATA_API_KEY, free up to 10k requests/day) knows Russian addresses best; without a key
// the free Photon geocoder (OpenStreetMap) is used, so the dropdowns work out of the box.
// Lookups only ever help — a failed or empty lookup leaves the field as plain text input.

const DADATA_API_KEY = process.env.DADATA_API_KEY;
const TIMEOUT_MS = 4000;
const LIMIT = 8;

export type AddressLevel = "city" | "street" | "house";

export type AddressSuggestion = {
  /** Bare name for the field: "Казань", "Ленина" / "улица Ленина", "5 к 2". */
  value: string;
  /** With its type, as it goes into the address line: "г Казань", "ул Ленина". */
  withType: string;
  /** Second line in the dropdown: region, district… */
  hint?: string;
  /** Narrows the next level: DaData "city:<fias>" / "settlement:<fias>" / street fias id. */
  id?: string;
  /** Photon: the city's box "minLon,minLat,maxLon,maxLat" for street/house lookups. */
  bbox?: string;
  postal?: string;
};

export type AddressContext = { cityId?: string; cityName?: string; bbox?: string; streetId?: string; streetName?: string };

async function fetchJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// --- DaData -----------------------------------------------------------------------------------

type DadataSuggestion = { value: string; data: Record<string, string | null> };

async function dadata(level: AddressLevel, q: string, ctx: AddressContext): Promise<AddressSuggestion[]> {
  const body: Record<string, unknown> = { query: q, count: LIMIT };
  if (level === "city") {
    Object.assign(body, { from_bound: { value: "city" }, to_bound: { value: "settlement" } });
  } else if (level === "street") {
    const [kind, fias] = (ctx.cityId ?? "").split(":");
    Object.assign(body, {
      from_bound: { value: "street" },
      to_bound: { value: "street" },
      ...(fias ? { locations: [{ [`${kind}_fias_id`]: fias }], restrict_value: true } : {}),
    });
  } else {
    Object.assign(body, {
      from_bound: { value: "house" },
      to_bound: { value: "house" },
      ...(ctx.streetId ? { locations: [{ street_fias_id: ctx.streetId }], restrict_value: true } : {}),
    });
  }
  const json = (await fetchJson("https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Token ${DADATA_API_KEY}` },
    body: JSON.stringify(body),
  })) as { suggestions?: DadataSuggestion[] };

  return (json.suggestions ?? []).flatMap(({ data: d }): AddressSuggestion[] => {
    if (level === "city") {
      const isSettlement = Boolean(d.settlement);
      const value = (isSettlement ? d.settlement : d.city) ?? "";
      if (!value) return [];
      const fias = isSettlement ? d.settlement_fias_id : d.city_fias_id;
      return [{
        value,
        withType: (isSettlement ? d.settlement_with_type : d.city_with_type) ?? value,
        hint: [isSettlement ? d.city_with_type : null, d.area_with_type, d.region_with_type].filter(Boolean).join(", "),
        id: fias ? `${isSettlement ? "settlement" : "city"}:${fias}` : undefined,
      }];
    }
    if (level === "street") {
      if (!d.street) return [];
      return [{ value: d.street, withType: d.street_with_type ?? d.street, id: d.street_fias_id ?? undefined }];
    }
    if (!d.house) return [];
    const house = [d.house, d.block_type && d.block ? `${d.block_type} ${d.block}` : null].filter(Boolean).join(" ");
    return [{ value: house, withType: `${d.house_type ?? "д"} ${house}`, postal: d.postal_code ?? undefined }];
  });
}

// --- Photon (OpenStreetMap) -------------------------------------------------------------------

type PhotonFeature = {
  properties: Record<string, string | number[] | undefined>;
  geometry: { coordinates: [number, number] };
};

function photonUrl(params: Record<string, string>): string {
  return `https://photon.komoot.io/api/?${new URLSearchParams({ limit: "20", ...params })}`;
}

async function photon(level: AddressLevel, q: string, ctx: AddressContext): Promise<AddressSuggestion[]> {
  const params: Record<string, string> =
    level === "city"
      ? { q, layer: "city" }
      : level === "street"
        ? { q, layer: "street", ...(ctx.bbox ? { bbox: ctx.bbox } : {}) }
        : { q: `${ctx.streetName ?? ""} ${q}`.trim(), layer: "house", ...(ctx.bbox ? { bbox: ctx.bbox } : {}) };
  const json = (await fetchJson(photonUrl(params), {
    headers: { "User-Agent": "lab-3d.pro checkout (address suggestions)" },
  })) as { features?: PhotonFeature[] };

  const seen = new Set<string>();
  const out: AddressSuggestion[] = [];
  for (const { properties: p, geometry } of json.features ?? []) {
    if (p.countrycode !== "RU") continue;
    const str = (key: string) => (typeof p[key] === "string" ? (p[key] as string) : "");
    let item: AddressSuggestion | null = null;
    if (level === "city") {
      const [lon, lat] = geometry.coordinates;
      const e = Array.isArray(p.extent) ? p.extent : [lon - 0.15, lat + 0.15, lon + 0.15, lat - 0.15];
      item = { value: str("name"), withType: str("name"), hint: [str("county"), str("state")].filter(Boolean).join(", "), bbox: [e[0], e[3], e[2], e[1]].join(",") };
    } else if (level === "street") {
      // The box is rectangular — drop streets of the neighbouring villages that fall inside it.
      if (ctx.cityName && str("city") && str("city") !== ctx.cityName) continue;
      item = { value: str("name"), withType: str("name") };
    } else {
      if (ctx.streetName && str("street") !== ctx.streetName) continue;
      item = { value: str("housenumber"), withType: `д. ${str("housenumber")}`, postal: str("postcode") || undefined };
    }
    const key = `${item.value}|${item.hint ?? ""}`;
    if (!item.value || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= LIMIT) break;
  }
  return out;
}

export async function suggestAddress(level: AddressLevel, q: string, ctx: AddressContext): Promise<AddressSuggestion[]> {
  try {
    return await (DADATA_API_KEY ? dadata(level, q, ctx) : photon(level, q, ctx));
  } catch (err) {
    console.error("[addressSuggest]", err instanceof Error ? err.message : err);
    return [];
  }
}
