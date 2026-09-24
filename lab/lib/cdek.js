// Клиент СДЭК API v2 (https://apidoc.cdek.ru/).
// Авторизация — OAuth client_credentials: «Account» и «Secure password» из личного кабинета СДЭК
// (Интеграция → API). Тестовый контур — api.edu.cdek.ru, боевой — api.cdek.ru.
// Единицы: вес в граммах, габариты в сантиметрах, суммы в рублях.
import { getSetting } from '../db.js';
import { addressQuery, addressWords, rankByAddress } from './address-match.js';

const PROD_BASE = 'https://api.cdek.ru/v2';
const TEST_BASE = 'https://api.edu.cdek.ru/v2';

// Без User-Agent/Accept запросы от Node.js выглядят как бот, и фильтр СДЭК отвечает 403.
const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; Lab3D-Orders/1.0; +https://github.com/Evorism03/New_Lab_3D)',
  Accept: 'application/json',
};

let tokenCache = { key: '', value: '', expiresAt: 0 };

function config() {
  const clientId = getSetting('cdek_client_id');
  const clientSecret = getSetting('cdek_client_secret');
  if (!clientId || !clientSecret) {
    throw new Error('Не заданы Account / Secure password СДЭК — заполните их в Настройках → СДЭК');
  }
  const base = getSetting('cdek_test_mode') === '1' ? TEST_BASE : PROD_BASE;
  return { clientId, clientSecret, base };
}

// Ошибки СДЭК: { errors: [{ code, message }] } или { requests: [{ errors: [...] }] }.
function cdekErrorText(data, status) {
  const errors = [
    ...(Array.isArray(data?.errors) ? data.errors : []),
    ...(Array.isArray(data?.requests) ? data.requests.flatMap((r) => r.errors || []) : []),
  ];
  if (errors.length) return errors.map((e) => [e.code, e.message].filter(Boolean).join(': ')).join('; ');
  if (data?.error_description || data?.error) return data.error_description || data.error;
  if (data?.message) return data.message;
  if (data?.raw) {
    const raw = String(data.raw);
    // Страница антибот-фильтра СДЭК (HTML «Forbidden») — показываем суть, а не разметку.
    if (/<html|<!doctype/i.test(raw)) {
      const text = raw.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      const ip = text.match(/IP:\s*([\d.:a-f]+)/i)?.[1];
      const title = text.split(' ').slice(0, 3).join(' ');
      return `${status} ${/forbidden/i.test(text) ? 'Forbidden' : title} — СДЭК заблокировал запрос на уровне защиты сети`
        + `${ip ? ` (IP сервера ${ip})` : ''}. Если ошибка повторяется, напишите в поддержку СДЭК (integrator@cdek.ru) с этим IP.`
        + ` Полный ответ: ${text.slice(0, 200)}`;
    }
    return raw.slice(0, 300);
  }
  return `HTTP ${status}`;
}

async function getToken(force) {
  const { clientId, clientSecret, base } = config();
  const key = `${base}|${clientId}|${clientSecret}`;
  if (!force && tokenCache.key === key && tokenCache.value && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.value;
  }
  // По спецификации параметры — в query-строке; дублируем их в теле формы, как делают
  // остальные клиенты СДЭК: пустой POST антибот-фильтр СДЭК может отклонить.
  const params = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret });
  const res = await fetch(`${base}/oauth/token?${params}`, {
    method: 'POST',
    headers: { ...BASE_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok || !data.access_token) {
    throw new Error(`СДЭК авторизация: ${cdekErrorText(data, res.status)}`);
  }
  tokenCache = { key, value: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return tokenCache.value;
}

async function authorizedFetch(url, init = {}) {
  let token = await getToken();
  const doFetch = () => fetch(url, { ...init, headers: { ...BASE_HEADERS, ...(init.headers || {}), Authorization: `Bearer ${token}` } });
  let res = await doFetch();
  if (res.status === 401) {
    token = await getToken(true);
    res = await doFetch();
  }
  return res;
}

export async function cdekRequest(method, pathname, { query, body } = {}) {
  const { base } = config();
  const url = new URL(`${base}${pathname}`);
  for (const [k, v] of Object.entries(query || {})) if (v != null && v !== '') url.searchParams.set(k, v);
  const res = await authorizedFetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`СДЭК ${method} ${pathname}: ${cdekErrorText(data, res.status)}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// --- Города и ПВЗ -------------------------------------------------------------------------

// Кандидаты населённого пункта из СДЭК: точный поиск /location/cities и подсказки
// /location/suggest/cities (у подсказок есть полное название с районом и регионом).
export async function findCities(name) {
  const [exact, suggested] = await Promise.all([
    cdekRequest('GET', '/location/cities', { query: { city: name, country_codes: 'RU', size: 20 } }).catch(() => []),
    cdekRequest('GET', '/location/suggest/cities', { query: { name, country_code: 'RU' } }).catch(() => []),
  ]);
  const byCode = new Map();
  for (const c of Array.isArray(exact) ? exact : []) {
    byCode.set(c.code, { code: c.code, city: c.city, label: [c.city, c.sub_region, c.region].filter(Boolean).join(', ') });
  }
  for (const c of Array.isArray(suggested) ? suggested : []) {
    const prev = byCode.get(c.code);
    const label = c.full_name || prev?.label || name;
    byCode.set(c.code, { code: c.code, city: prev?.city || String(label).split(',')[0].trim(), label });
  }
  return [...byCode.values()];
}

export async function deliveryPoints(query) {
  const list = await cdekRequest('GET', '/deliverypoints', { query });
  return Array.isArray(list) ? list : [];
}

function describePoint(p) {
  return {
    code: p.code,
    name: p.name || '',
    type: p.type || '',
    full_address: p.location?.address_full || [p.location?.city, p.location?.address].filter(Boolean).join(', '),
    city_code: p.location?.city_code ?? null,
    city: p.location?.city || '',
    work_time: p.work_time || '',
  };
}

// ПВЗ СДЭК по адресу: город → код города СДЭК → пункты города → сравнение улицы и дома.
// purpose: 'handout' — пункт выдачи (для получателя), 'reception' — приём посылок (для отправки).
export async function findPointsByAddress(addressText, limit = 5, purpose = 'handout') {
  const query = addressQuery(addressText);
  const L = globalThis.LabAddress;
  // Названия для поиска: населённые пункты от самого мелкого, затем поселения/СНТ из того же поля
  // («Москва, поселение Десёновское» → Москва, Десёновское).
  const chunks = String(query.parts.city || '').split(',').map((c) => c.trim()).filter(Boolean);
  const settlementNames = chunks
    .filter((c) => /поселени|снт|днт|тсн|(^|\s)кп(\s|$)|(^|\s)нп(\s|$)/i.test(c))
    .map((c) => c.replace(/(сельское|городское)?\s*поселение|снт|днт|тсн|(^|\s)кп(\s|$)|(^|\s)нп(\s|$)/gi, ' ').trim())
    .filter(Boolean);
  const names = [...new Set([...L.cityNames(query.parts), ...settlementNames])].slice(0, 3);
  if (!names.length) throw new Error('Не удалось определить город в адресе ПВЗ');

  // Все слова «городской» части адреса (регион, район, посёлок) — по ним выбираем, какой из
  // одноимённых населённых пунктов СДЭК имеется в виду.
  const localityWords = addressWords(query.parts.city);
  const scored = new Map();
  for (const name of names) {
    const nameWords = addressWords(name);
    for (const c of await findCities(name)) {
      const labelWords = addressWords(c.label);
      let score = addressWords(c.city).join(' ') === nameWords.join(' ') ? 3 : 0;
      score += localityWords.filter((w) => labelWords.includes(w)).length;
      if (!scored.has(c.code) || scored.get(c.code).score < score) scored.set(c.code, { ...c, score });
    }
  }
  const cities = [...scored.values()].sort((a, b) => b.score - a.score).slice(0, 3);
  if (!cities.length) throw new Error(`СДЭК не знает населённый пункт «${names.join('» / «')}»`);

  const filter = purpose === 'reception' ? { is_reception: 'true' } : { is_handout: 'true' };
  const perCity = await Promise.all(cities.map(async (city) => {
    const points = (await deliveryPoints({ city_code: city.code, type: 'ALL', ...filter })).map((p) => {
      const d = describePoint(p);
      return { ...d, words: addressWords(`${p.location?.address || ''} ${p.location?.address_full || ''}`) };
    });
    // Город уже отфильтрован запросом — сравниваем улицу и дом; точность выбора города — бонусом.
    return rankByAddress(points, query, limit, { ignoreCity: true })
      .map(({ point, score }) => ({ point, score: score + city.score }));
  }));
  return perCity.flat()
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ point, score }) => {
      const { words, ...rest } = point;
      return { ...rest, score: Math.round(score * 10) / 10 };
    });
}

export async function pointInfo(code) {
  const list = await deliveryPoints({ code });
  return list[0] ? describePoint(list[0]) : null;
}

// --- Расчёт, заказы, этикетки -------------------------------------------------------------

export function calculateTariff(body) {
  return cdekRequest('POST', '/calculator/tariff', { body });
}

export function createOrder(body) {
  return cdekRequest('POST', '/orders', { body });
}

export function getOrder(uuid) {
  return cdekRequest('GET', `/orders/${encodeURIComponent(uuid)}`);
}

export function deleteOrder(uuid) {
  return cdekRequest('DELETE', `/orders/${encodeURIComponent(uuid)}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Этикетка (ШК места): СДЭК формирует PDF асинхронно — создаём задание и ждём ссылку.
export async function barcodePdf(orderUuid, format = 'A6') {
  const created = await cdekRequest('POST', '/print/barcodes', {
    body: { orders: [{ order_uuid: orderUuid }], copy_count: 1, format },
  });
  const printUuid = created?.entity?.uuid;
  if (!printUuid) throw new Error(`СДЭК не создал задание на печать: ${cdekErrorText(created, 200)}`);
  let url = '';
  for (let i = 0; i < 15 && !url; i++) {
    await sleep(i ? 1000 : 500);
    const info = await cdekRequest('GET', `/print/barcodes/${printUuid}`);
    url = info?.entity?.url || '';
    const invalid = (info?.entity?.statuses || []).find((s) => s.code === 'INVALID');
    if (invalid) throw new Error(`СДЭК не смог сформировать этикетку: ${cdekErrorText(info, 200)}`);
  }
  if (!url) throw new Error('СДЭК ещё формирует этикетку — попробуйте через несколько секунд');
  const res = await authorizedFetch(url);
  if (!res.ok) throw new Error(`Не удалось скачать этикетку СДЭК (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}
