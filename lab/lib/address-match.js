// Подбор пункта выдачи по адресу — общий для Ozon и СДЭК. Адрес заказа разбирается на части
// (public/address.js), а адреса пунктов сравниваются по словам: город и улица обязательны,
// номер дома — решающий.
import '../public/address.js'; // globalThis.LabAddress

// Расстояние Левенштейна с ранним выходом (нужно только «≤ 1»).
function editDistanceAtMost1(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

// Слова совпадают: точно; одно — начало другого («Ленинск» / «Ленинский»); отличаются только
// окончанием («Нововатутинская» / «Нововатутинской»); или опечаткой в одну букву (длинные слова).
// Числа и номера («2я», «12а») сравниваются только точно.
function wordMatches(a, b) {
  if (a === b) return true;
  if (/\d/.test(a) || /\d/.test(b)) return false;
  const min = Math.min(a.length, b.length);
  if (min < 4) return false;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  let common = 0;
  while (common < min && a[common] === b[common]) common++;
  if (common >= Math.max(4, min - 3)) return true;
  return min >= 6 && editDistanceAtMost1(a, b);
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
    // Регион/район/поселение в сравнении не участвуют; подходит любой из населённых пунктов
    // («Москва, п. Внуковское» — пункт может быть записан и как Москва, и как Внуковское).
    cities: globalThis.LabAddress.cityNames(parts).map(addressWords).filter((w) => w.length),
    street: addressWords(parts.street),
    house: addressWords(parts.house),
    extra: addressWords(parts.extra),
  };
  if (!query.cities.length && !query.street.length) {
    throw new Error('Не удалось разобрать адрес ПВЗ — укажите хотя бы город и улицу');
  }
  return query;
}

// words — слова адреса пункта (addressWords). 0 — не подходит.
// strict: город (любой из населённых пунктов) и хотя бы одно слово улицы обязательны.
// Нестрогий режим — когда строго ничего не нашлось: город не обязателен (даёт бонус), улица — да.
export function scoreAddress(words, query, { ignoreCity = false, strict = true } = {}) {
  const has = (w) => words.some((pw) => wordMatches(pw, w));
  const cityHit = !query.cities.length || query.cities.some((cityWords) => cityWords.every(has));
  if (!ignoreCity && strict && !cityHit) return 0;
  const streetHits = query.street.filter(has).length;
  if (query.street.length && !streetHits) return 0;
  // Доля совпавших слов улицы: «2я Нововатутинская» vs просто «Нововатутинская».
  let score = 1 + (query.street.length ? (streetHits / query.street.length) * 4 : 0);
  if (!ignoreCity && cityHit) score += 1;
  if (query.house.length) {
    const [houseNum, ...houseRest] = query.house;
    const digits = (w) => w.replace(/[^\d]/g, '');
    if (words.includes(houseNum)) {
      score += 5;
      // корпус/строение тоже совпали — ещё точнее
      score += houseRest.filter((w) => words.includes(w)).length;
    } else if (words.some((w) => digits(w) && digits(w) === digits(houseNum))) {
      score += 2;
    }
  }
  score += query.extra.filter(has).length * 0.5;
  return score;
}

// points: [{ words, ... }] → лучшие совпадения [{ point, score }].
// Сначала строго; если ничего — нестрого (город может быть записан у службы доставки иначе).
export function rankByAddress(points, query, limit = 5, options = {}) {
  const run = (strict) => points
    .map((point) => ({ point, score: scoreAddress(point.words, query, { ...options, strict }), relaxed: !strict }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  const strictResult = run(true);
  return strictResult.length || options.ignoreCity ? strictResult : run(false);
}
