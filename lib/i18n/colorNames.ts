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
