import type { Locale } from "./translations";

// Catalog rows (colors, finishes, material texts) live in the database in English.
// For the Russian site an admin-entered `nameRu` wins; otherwise these built-in translations
// of the seeded catalog are used; otherwise the original text is shown as is.
const RU_BY_EN: Record<string, string> = {
  // colors
  Black: "Чёрный",
  White: "Белый",
  Grey: "Серый",
  Gray: "Серый",
  Natural: "Натуральный",
  Clear: "Прозрачный",
  Red: "Красный",
  Blue: "Синий",
  Green: "Зелёный",
  Yellow: "Жёлтый",
  Orange: "Оранжевый",
  // finishes
  Standard: "Стандартная",
  Sanded: "Шлифованная",
  // material descriptions
  "Biodegradable plastic for prototypes. Easy to print, low heat resistance.":
    "Биоразлагаемый пластик для прототипов. Легко печатается, низкая термостойкость.",
  "A balance of strength and flexibility. Moisture and chemical resistant.":
    "Баланс прочности и гибкости. Устойчив к влаге и химии.",
  "Strong, heat-resistant plastic for mechanically loaded parts.":
    "Прочный термостойкий пластик для механически нагруженных деталей.",
  "Reliable, general-purpose material for stable functional components.":
    "Надёжный универсальный материал для стабильных функциональных деталей.",
  "Flexible and elastic. Highly resistant to deformation and wear.":
    "Гибкий и эластичный. Хорошо переносит деформацию и износ.",
  "Engineering-grade polyamide with high wear and chemical resistance.":
    "Инженерный полиамид с высокой износо- и химической стойкостью.",
  "Polycarbonate — maximum strength for heavily loaded, high-temperature parts.":
    "Поликарбонат — максимальная прочность для сильно нагруженных и высокотемпературных деталей.",
  "Lightweight and chemical-resistant. Durable for long-lasting parts.":
    "Лёгкий и химически стойкий. Подходит для деталей с долгим сроком службы.",
  // "best for" lines
  "Prototypes, decorative models": "Прототипы, декоративные модели",
  "Functional parts, moisture-resistant enclosures": "Функциональные детали, влагостойкие корпуса",
  "Enclosures and mechanically loaded parts": "Корпуса и механически нагруженные детали",
  "Stable functional components": "Стабильные функциональные компоненты",
  "Hinges, gaskets, flexible covers": "Петли, прокладки, гибкие крышки",
  "Gears, wear-resistant assemblies": "Шестерни, износостойкие узлы",
  "High-load, high-temperature parts": "Сильно нагруженные, высокотемпературные детали",
  "Living hinges, chemical-resistant containers": "Живые петли, химически стойкие контейнеры",
};

/** Display text for the given locale: RU uses `nameRu`, then the built-in translation, then the original. */
export function localizeCatalogText(text: string, locale: Locale, textRu?: string | null): string;
export function localizeCatalogText(text: string | null, locale: Locale, textRu?: string | null): string | null;
export function localizeCatalogText(text: string | null, locale: Locale, textRu?: string | null): string | null {
  if (locale !== "ru") return text;
  if (textRu && textRu.trim()) return textRu.trim();
  if (text === null) return null;
  return RU_BY_EN[text] ?? text;
}
