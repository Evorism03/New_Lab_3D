// Клиент Ozon Delivery API (https://api-delivery.ozon.ru).
// Аутентификация — server-to-server client_credentials (без OAuth-редиректа через браузер,
// в отличие от ВК): POST на https://xapi.ozon.ru/oauth/token с client_id/client_secret.
//
// У Ozon перед API стоит защита от DDoS (testcookie): на первый запрос сервер может ответить
// редиректом 302/307 с Set-Cookie — нужно повторить тот же запрос по новому адресу с этой
// cookie и переиспользовать её дальше. Значение cookie может меняться без предупреждения,
// поэтому храним его в памяти процесса и обновляем при каждом редиректе.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSetting } from '../db.js';
import { addressQuery, addressWords, rankByAddress } from './address-match.js';

const AUTH_URL = 'https://xapi.ozon.ru/oauth/token';
const API_BASE = 'https://api-delivery.ozon.ru';

const SCOPES = [
  'delivery-api.shipment-method',
  'delivery-api.dropoff-point',
  'delivery-api.return-point',
  'delivery-api.delivery',
  'delivery-api.delivery-point',
  'delivery-api.order',
  'delivery-api.posting',
  'delivery-api.container',
  'delivery-api.return',
];

let tokenCache = { value: '', expiresAt: 0 };
let cookieJar = '';

function credentials() {
  const clientId = getSetting('ozon_client_id');
  const clientSecret = getSetting('ozon_client_secret');
  if (!clientId || !clientSecret) {
    throw new Error('Не заданы Ozon Client ID / Client Secret — заполните их на странице «Ozon Доставка»');
  }
  return { clientId, clientSecret };
}

async function fetchToken() {
  const { clientId, clientSecret } = credentials();
  const res = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
      scope: SCOPES,
    }),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookieJar = setCookie;
  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Ozon OAuth: не удалось разобрать ответ (${res.status}): ${text.slice(0, 200)}`);
    }
  }
  if (!res.ok || !data.access_token) {
    throw new Error(`Ozon OAuth: ${res.status} ${data.error_description || data.error || text.slice(0, 200)}`);
  }
  tokenCache = {
    value: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in || 3600) - 60) * 1000,
  };
  return tokenCache.value;
}

async function getToken(force) {
  if (!force && tokenCache.value && Date.now() < tokenCache.expiresAt) return tokenCache.value;
  return fetchToken();
}

function buildHeaders(token, extra) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    ...extra,
  };
  if (cookieJar) headers.Cookie = cookieJar;
  return headers;
}

// Один POST-запрос с ручной обработкой редиректа testcookie-защиты (максимум одна попытка
// следования за редиректом — второй такой же редирект означает настоящую проблему, а не
// защиту от ботов, и должен всплыть как ошибка, а не зациклиться).
async function rawRequest(pathname, body, token, extraHeaders) {
  let res = await fetch(`${API_BASE}${pathname}`, {
    method: 'POST',
    headers: buildHeaders(token, extraHeaders),
    body: JSON.stringify(body || {}),
    redirect: 'manual',
  });
  if (res.status === 302 || res.status === 307) {
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookieJar = setCookie;
    const location = res.headers.get('location');
    if (location) {
      const nextUrl = location.startsWith('http') ? location : `${API_BASE}${location}`;
      res = await fetch(nextUrl, {
        method: 'POST',
        headers: buildHeaders(token, extraHeaders),
        body: JSON.stringify(body || {}),
        redirect: 'manual',
      });
    }
  }
  return res;
}

// Ozon может вернуть ошибку в разных формах: { message }, { error: "..." },
// { error: { code, message, details } }, { code, message, details: [...] }. Собираем читаемый
// текст, чтобы вместо «[object Object]» пользователь видел реальную причину.
function stringifyPart(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(stringifyPart).filter(Boolean).join('; ');
  if (typeof value === 'object') {
    const main = stringifyPart(value.message) || stringifyPart(value.error_description)
      || stringifyPart(value.error) || stringifyPart(value.description);
    const code = typeof value.code === 'string' || typeof value.code === 'number' ? String(value.code) : '';
    const details = stringifyPart(value.details) || stringifyPart(value.errors);
    const field = stringifyPart(value.field) || stringifyPart(value.path);
    const head = code && main ? `${code}: ${main}` : (main || code);
    const parts = [field && head ? `${field}: ${head}` : head, details].filter(Boolean);
    if (parts.length) return parts.join(' — ');
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return String(value);
}

function errorMessage(data, status) {
  const text = stringifyPart(data.raw != null ? data.raw.slice(0, 500) : data);
  return text && text !== '{}' ? `${status} ${text}` : `HTTP ${status}`;
}

async function authorizedRequest(pathname, body, extraHeaders) {
  let token = await getToken();
  let res = await rawRequest(pathname, body, token, extraHeaders);
  if (res.status === 401) {
    token = await getToken(true);
    res = await rawRequest(pathname, body, token, extraHeaders);
  }
  return res;
}

export async function ozonRequest(pathname, body = {}, { idempotencyKey } = {}) {
  const extraHeaders = idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined;
  const res = await authorizedRequest(pathname, body, extraHeaders);
  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  if (!res.ok) {
    const err = new Error(`Ozon API ${pathname}: ${errorMessage(data, res.status)}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function checkClient(phoneNumber) {
  return ozonRequest('/v1/delivery/check-client', { phone_number: phoneNumber });
}

export function deliveryLocation(coordinates, shipmentMethods) {
  return ozonRequest('/v1/delivery/location', { coordinates, shipment_methods: shipmentMethods });
}

export function searchDropoffPoints(filters, pagination) {
  // is_bulky Ozon требует обязательно — без него запрос не проходит валидацию.
  return ozonRequest('/v1/dropoff-point/search', { filters: { is_bulky: false, ...filters }, pagination });
}

export function dropoffPointInfo(dropoffPointIds) {
  return ozonRequest('/v1/dropoff-point/info', { dropoff_point_ids: dropoffPointIds });
}

export function searchReturnPoints(filters, pagination) {
  return ozonRequest('/v1/return-point/search', { filters, pagination });
}

export function returnPointInfo(returnPointIds) {
  return ozonRequest('/v1/return-point/info', { return_point_ids: returnPointIds });
}

export function createShipmentMethod(data) {
  return ozonRequest('/v1/shipment-method/create', data);
}

export function updateShipmentMethod(data) {
  return ozonRequest('/v1/shipment-method/update', data);
}

export function shipmentMethodInfo(shipmentMethodIds) {
  return ozonRequest('/v1/shipment-method/info', { shipment_method_ids: shipmentMethodIds });
}

export function searchShipmentMethods(filters, pagination) {
  return ozonRequest('/v1/shipment-method/search', { filters, pagination });
}

export function deleteShipmentMethod(shipmentMethodId) {
  return ozonRequest('/v1/shipment-method/delete', { shipment_method_id: shipmentMethodId });
}

export function deliveryPointList(pagination) {
  return ozonRequest('/v1/delivery-point/list', { pagination });
}

export function deliveryPointInfo(deliveryPointIds) {
  return ozonRequest('/v1/delivery-point/info', { delivery_point_ids: deliveryPointIds });
}

export function deliveryPointCheckAvailability(deliveryPointIds, shipmentMethodId, postings) {
  return ozonRequest('/v1/delivery-point/check-availability', {
    delivery_point_ids: deliveryPointIds,
    shipment_method_id: shipmentMethodId,
    postings,
  });
}

export function orderCheckout(payload) {
  return ozonRequest('/v1/order/checkout', payload);
}

export function orderCreate(payload, idempotencyKey) {
  return ozonRequest('/v1/order/create', payload, { idempotencyKey });
}

export function postingApprove(postingNumber) {
  return ozonRequest('/v1/posting/approve', { posting_number: postingNumber });
}

export function postingInfo(postingNumbers) {
  return ozonRequest('/v1/posting/info', { posting_numbers: postingNumbers });
}

// Этикетка: Ozon может отдать сам PDF (бинарно) или JSON с base64-содержимым либо ссылкой.
// Возвращаем { buffer, contentType } или бросаем ошибку с тем, что Ozon ответил.
export async function postingLabelFile(postingNumber) {
  const pathname = '/v1/posting/label';
  const res = await authorizedRequest(pathname, { posting_number: postingNumber });
  const contentType = res.headers.get('content-type') || '';
  const buffer = Buffer.from(await res.arrayBuffer());
  const isPdf = buffer.subarray(0, 5).toString('latin1') === '%PDF-';
  if (res.ok && (isPdf || /pdf|octet-stream|image\//i.test(contentType))) {
    return { buffer, contentType: isPdf ? 'application/pdf' : contentType };
  }
  const text = buffer.toString('utf8');
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) throw new Error(`Ozon API ${pathname}: ${errorMessage(data, res.status)}`);

  const holder = data.result || data.label || data;
  const base64 = holder.file_content || holder.fileContent || holder.content || holder.file || holder.data || holder.pdf;
  if (typeof base64 === 'string' && base64.length > 100) {
    const decoded = Buffer.from(base64, 'base64');
    const decodedIsPdf = decoded.subarray(0, 5).toString('latin1') === '%PDF-';
    return { buffer: decoded, contentType: decodedIsPdf ? 'application/pdf' : (holder.content_type || holder.file_type || 'application/pdf') };
  }
  const url = holder.url || holder.file_url || holder.label_url || holder.link;
  if (typeof url === 'string' && /^https?:/i.test(url)) {
    const fileRes = await fetch(url);
    if (!fileRes.ok) throw new Error(`Не удалось скачать этикетку по ссылке Ozon (${fileRes.status})`);
    return { buffer: Buffer.from(await fileRes.arrayBuffer()), contentType: fileRes.headers.get('content-type') || 'application/pdf' };
  }
  const shown = text.length > 300 ? `${text.slice(0, 300)}…` : text;
  throw new Error(`Ozon не вернул этикетку. Обычно она появляется после «Подтвердить к отгрузке». Ответ Ozon: ${shown || 'пусто'}`);
}

export function postingCancel(postingNumber) {
  return ozonRequest('/v1/posting/cancel', { posting_number: postingNumber });
}

export function postingStatusHistory(postingNumber) {
  return ozonRequest('/v1/posting/status-history', { posting_number: postingNumber });
}

export function postingSearch(filters, pagination) {
  return ozonRequest('/v1/posting/search', { filters, pagination });
}

// --- Поиск ПВЗ по адресу -------------------------------------------------------------------
// Отдельного поиска ПВЗ по адресу в Ozon Delivery API нет, поэтому один раз выкачиваем полный
// список (/v1/delivery-point/list, при необходимости дополняя адреса через /info), держим его
// в памяти и сравниваем адрес локально. Формат ответа Ozon разбираем осторожно — поля ищем
// под несколькими возможными именами.
const POINTS_TTL_MS = 12 * 60 * 60 * 1000;
let pointsCache = { points: null, loadedAt: 0, loading: null };

function pickArray(obj, keys) {
  for (const k of keys) if (Array.isArray(obj?.[k])) return obj[k];
  return null;
}

function pointId(p) {
  return p?.delivery_point_id ?? p?.id ?? p?.point_id ?? null;
}

// Все строковые поля адреса одной строкой — чтобы не зависеть от того, как Ozon его разбил.
function pointAddressText(p) {
  const parts = [];
  if (p.full_address) parts.push(p.full_address);
  const walk = (v) => {
    if (typeof v === 'string') parts.push(v);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  if (!p.full_address) {
    walk(p.address);
    // Адрес может лежать под другим именем (location, address_details…) — берём всё, где есть «address».
    if (!parts.length) {
      for (const [k, v] of Object.entries(p)) if (/address|location/i.test(k)) walk(v);
    }
  }
  if (!parts.length && p.name) parts.push(p.name);
  return parts.join(', ');
}

async function loadAllPointIdsAndData() {
  const byId = new Map();
  let cursor;
  let offset = 0;
  for (let page = 0; page < 2000; page++) {
    const pagination = { limit: 100 }; // Ozon: размер страницы от 1 до 100
    if (cursor) pagination.cursor = cursor;
    else if (offset) pagination.offset = offset;
    const res = await ozonRequest('/v1/delivery-point/list', { pagination });
    const list = pickArray(res, ['delivery_points', 'points', 'items', 'result']) || [];
    let added = 0;
    for (const item of list) {
      const p = typeof item === 'object' ? item : { delivery_point_id: item };
      const id = pointId(p);
      if (id != null && !byId.has(String(id))) { byId.set(String(id), p); added++; }
    }
    const next = res?.pagination?.cursor ?? res?.cursor ?? res?.next_cursor ?? res?.pagination?.next_cursor;
    const hasNext = res?.has_next ?? res?.pagination?.has_next ?? Boolean(next);
    if (!added || !hasNext) break;
    if (next) cursor = next; else offset += list.length;
  }
  if (!byId.size) throw new Error('Ozon вернул пустой список ПВЗ (/v1/delivery-point/list)');
  return [...byId.values()];
}

async function fillAddresses(points) {
  const missing = points.filter((p) => !pointAddressText(p));
  if (!missing.length) return points;
  const infoById = new Map();
  const batches = [];
  for (let i = 0; i < missing.length; i += 100) batches.push(missing.slice(i, i + 100).map((p) => Number(pointId(p))));
  let next = 0;
  async function worker() {
    while (next < batches.length) {
      let batch = batches[next++];
      // В общем списке встречаются уже закрытые ПВЗ — /info отвечает на них 404 со списком ID.
      // Убираем такие ID и повторяем; если не получается — пропускаем пачку, а не весь поиск.
      for (let attempt = 0; attempt < 3 && batch.length; attempt++) {
        try {
          const res = await deliveryPointInfo(batch);
          for (const p of pickArray(res, ['delivery_points', 'points', 'items']) || []) infoById.set(String(pointId(p)), p);
          break;
        } catch (err) {
          if (err.status !== 404) throw err;
          const missing = new Set((String(err.message).match(/\d{4,}/g) || []).map(Number));
          const rest = batch.filter((id) => !missing.has(id));
          if (rest.length === batch.length) break;
          batch = rest;
        }
      }
    }
  }
  await Promise.all(Array.from({ length: 5 }, worker));
  return points.map((p) => infoById.get(String(pointId(p))) || p).filter((p) => pointAddressText(p));
}

// Список ПВЗ большой (страницами по 100), поэтому кроме памяти храним его на диске —
// после перезапуска сервера не нужно выкачивать заново.
const POINTS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'ozon-delivery-points.json');

function prepare(points, loadedAt) {
  const prepared = points.map((p) => {
    const address = pointAddressText(p);
    return { raw: p, id: String(pointId(p)), address, words: addressWords(address) };
  });
  return { points: prepared, loadedAt, loading: null };
}

function readPointsFile() {
  try {
    const saved = JSON.parse(fs.readFileSync(POINTS_FILE, 'utf8'));
    if (Array.isArray(saved.points) && Date.now() - saved.loadedAt < POINTS_TTL_MS) return saved;
  } catch {
    // файла нет или он повреждён — загрузим заново
  }
  return null;
}

async function getAllDeliveryPoints() {
  if (pointsCache.points && Date.now() - pointsCache.loadedAt < POINTS_TTL_MS) return pointsCache.points;
  if (!pointsCache.points) {
    const saved = readPointsFile();
    if (saved) {
      pointsCache = prepare(saved.points, saved.loadedAt);
      return pointsCache.points;
    }
  }
  if (!pointsCache.loading) {
    pointsCache.loading = (async () => {
      const points = await fillAddresses(await loadAllPointIdsAndData());
      const loadedAt = Date.now();
      try {
        fs.writeFileSync(POINTS_FILE, JSON.stringify({ loadedAt, points }));
      } catch {
        // не удалось сохранить — останется только в памяти
      }
      pointsCache = prepare(points, loadedAt);
      return pointsCache.points;
    })().catch((err) => {
      pointsCache.loading = null;
      throw err;
    });
  }
  return pointsCache.loading;
}

export async function findDeliveryPointsByAddress(addressText, limit = 5) {
  const query = addressQuery(addressText);
  const points = await getAllDeliveryPoints();
  return rankByAddress(points, query, limit).map(({ point: p, score }) => ({
    delivery_point_id: p.id,
    full_address: p.address,
    name: p.raw.name || '',
    type: p.raw.type || '',
    score,
  }));
}
