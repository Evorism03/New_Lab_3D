// Подбор пункта выдачи по адресу — общий для Ozon и СДЭК. Адрес заказа разбирается на части
// (public/address.js), а адреса пунктов сравниваются по словам: город и улица обязательны,
// номер дома — решающий.
import '../public/address.js'; // globalThis.LabAddress

function wordMatches(a, b) {
  return a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));
}

export function addressWords(text) {
  return globalThis.LabAddress.normalizeWords(text);
}

// Разобранный адрес заказа в виде наборов слов для сравнения.
export function addressQuery(addressText) {
  const { parseAddress } = globalThis.LabAddress;
  const parts = parseAddress(addressText);
  const query = {
    parts,
    // Регион в сравнении не участвует — берём только последний кусок (сам город).
    city: addressWords(String(parts.city).split(',').pop()),
    street: addressWords(parts.street),
    house: addressWords(parts.house),
    extra: addressWords(parts.extra),
  };
  if (!query.city.length && !query.street.length) {
    throw new Error('Не удалось разобрать адрес ПВЗ — укажите хотя бы город и улицу');
  }
  return query;
}

// words — слова адреса пункта (addressWords). 0 — не подходит.
export function scoreAddress(words, query, { ignoreCity = false } = {}) {
  const has = (w) => words.some((pw) => wordMatches(pw, w));
  if (!ignoreCity && query.city.length && !query.city.every(has)) return 0;
  const streetHits = query.street.filter(has).length;
  if (query.street.length && !streetHits) return 0;
  let score = 1 + streetHits * 2;
  if (query.house.length) {
    const houseNum = query.house[0];
    if (words.includes(houseNum)) score += 5;
    else if (words.some((w) => w.replace(/[^\d]/g, '') === houseNum.replace(/[^\d]/g, ''))) score += 2;
  }
  score += query.extra.filter(has).length * 0.5;
  return score;
}

// points: [{ words, ... }] → лучшие совпадения [{ point, score }].
export function rankByAddress(points, query, limit = 5, options) {
  return points
    .map((point) => ({ point, score: scoreAddress(point.words, query, options) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
