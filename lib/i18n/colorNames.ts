// The admin types a color name in Russian only; the English name (used on the English site
// and as the stored canonical `name`) is derived from this dictionary.

const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");

// Base colors, keyed by the Russian name as an admin would type it.
const BASE: Record<string, string> = {
  белый: "white",
  черный: "black",
  серый: "grey",
  красный: "red",
  бордовый: "burgundy",
  розовый: "pink",
  оранжевый: "orange",
  желтый: "yellow",
  зеленый: "green",
  салатовый: "lime",
  оливковый: "olive",
  бирюзовый: "turquoise",
  голубой: "light blue",
  синий: "blue",
  фиолетовый: "purple",
  сиреневый: "lilac",
  лавандовый: "lavender",
  пурпурный: "magenta",
  коричневый: "brown",
  бежевый: "beige",
  песочный: "sand",
  хаки: "khaki",
  мятный: "mint",
  золотой: "gold",
  серебряный: "silver",
  бронзовый: "bronze",
  медный: "copper",
  натуральный: "natural",
  прозрачный: "clear",
  полупрозрачный: "translucent",
  молочный: "milky",
  "слоновая кость": "ivory",
  графитовый: "graphite",
  изумрудный: "emerald",
  персиковый: "peach",
  коралловый: "coral",
  терракотовый: "terracotta",
  // finishes / effects that often go with a color name
  матовый: "matte",
  глянцевый: "glossy",
  металлик: "metallic",
  неоновый: "neon",
  флуоресцентный: "fluorescent",
  светящийся: "glow-in-the-dark",
};

// "светло-серый" → "light grey", "тёмно-синий" → "dark blue"
const PREFIXES: Record<string, string> = {
  "светло-": "light ",
  "темно-": "dark ",
  "ярко-": "bright ",
  "бледно-": "pale ",
  "нежно-": "soft ",
};

function translateWord(word: string): string | null {
  if (BASE[word]) return BASE[word];
  for (const [prefix, en] of Object.entries(PREFIXES)) {
    if (word.startsWith(prefix)) {
      const rest = BASE[word.slice(prefix.length)];
      if (rest) return en + rest;
    }
  }
  return null;
}

/** English name for a Russian color name, or null when some word is not in the dictionary. */
export function translateColorRuToEn(ru: string): string | null {
  const value = norm(ru);
  if (!value) return null;
  // Whole phrase first ("слоновая кость"), then word by word ("светло-серый металлик").
  const whole = translateWord(value);
  if (whole) return capitalize(whole);
  const parts = value.split(" ").map(translateWord);
  if (parts.some((p) => p === null)) return null;
  return capitalize(parts.join(" "));
}

/** What gets stored as the canonical `name`: the translation, or the Russian text when unknown. */
export function colorNameEn(ru: string): string {
  return translateColorRuToEn(ru) ?? ru.trim();
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Reference shades for naming a color that only comes with a hex (Bambuddy spools often have
// no color name). Russian names from BASE, so colorNameEn() translates every one of them.
const HEX_NAMES: [string, string][] = [
  ["Белый", "#ffffff"],
  ["Чёрный", "#000000"],
  ["Серый", "#808080"],
  ["Светло-серый", "#c0c0c0"],
  ["Тёмно-серый", "#404040"],
  ["Красный", "#e02020"],
  ["Бордовый", "#800020"],
  ["Розовый", "#f06292"],
  ["Оранжевый", "#ff8000"],
  ["Жёлтый", "#ffd800"],
  ["Зелёный", "#20a040"],
  ["Тёмно-зелёный", "#0b5d1e"],
  ["Салатовый", "#9be030"],
  ["Оливковый", "#808000"],
  ["Бирюзовый", "#30d5c8"],
  ["Голубой", "#6ec6ff"],
  ["Синий", "#1e50c8"],
  ["Тёмно-синий", "#0a1f5c"],
  ["Фиолетовый", "#7b2cbf"],
  ["Сиреневый", "#c8a2c8"],
  ["Пурпурный", "#c0187a"],
  ["Коричневый", "#6b3e1f"],
  ["Бежевый", "#e8d5b0"],
  ["Золотой", "#d4af37"],
  ["Бронзовый", "#cd7f32"],
];

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Russian name of the closest reference shade; "Прозрачный" for mostly transparent colors. */
export function colorNameRuFromHex(hex: string, alpha = 255): string {
  if (alpha < 128) return "Прозрачный";
  const [r, g, b] = rgb(hex);
  let best = HEX_NAMES[0];
  let bestDistance = Infinity;
  for (const entry of HEX_NAMES) {
    const [r2, g2, b2] = rgb(entry[1]);
    // "Redmean" weighting — closer to perceived difference than plain RGB distance.
    const mean = (r + r2) / 2;
    const distance = (2 + mean / 256) * (r - r2) ** 2 + 4 * (g - g2) ** 2 + (2 + (255 - mean) / 256) * (b - b2) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = entry;
    }
  }
  return best[0];
}

/** Suggestions for the admin's name field: the popular plastic colors. */
export const POPULAR_COLORS_RU = [
  "Белый",
  "Чёрный",
  "Серый",
  "Светло-серый",
  "Тёмно-серый",
  "Красный",
  "Бордовый",
  "Розовый",
  "Оранжевый",
  "Жёлтый",
  "Зелёный",
  "Светло-зелёный",
  "Тёмно-зелёный",
  "Салатовый",
  "Оливковый",
  "Бирюзовый",
  "Голубой",
  "Синий",
  "Тёмно-синий",
  "Фиолетовый",
  "Сиреневый",
  "Пурпурный",
  "Коричневый",
  "Бежевый",
  "Золотой",
  "Серебряный",
  "Бронзовый",
  "Медный",
  "Натуральный",
  "Прозрачный",
  "Полупрозрачный",
  "Молочный",
  "Слоновая кость",
  "Хаки",
  "Мятный",
  "Неоновый зелёный",
  "Неоновый оранжевый",
  "Светящийся",
];
