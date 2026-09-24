// Клиент Ozon Delivery API (https://api-delivery.ozon.ru).
// Аутентификация — server-to-server client_credentials (без OAuth-редиректа через браузер,
// в отличие от ВК): POST на https://xapi.ozon.ru/oauth/token с client_id/client_secret.
//
// У Ozon перед API стоит защита от DDoS (testcookie): на первый запрос сервер может ответить
// редиректом 302/307 с Set-Cookie — нужно повторить тот же запрос по новому адресу с этой
// cookie и переиспользовать её дальше. Значение cookie может меняться без предупреждения,
// поэтому храним его в памяти процесса и обновляем при каждом редиректе.
import { getSetting } from '../db.js';

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

export async function ozonRequest(pathname, body = {}, { idempotencyKey } = {}) {
  const extraHeaders = idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined;
  let token = await getToken();
  let res = await rawRequest(pathname, body, token, extraHeaders);
  if (res.status === 401) {
    token = await getToken(true);
    res = await rawRequest(pathname, body, token, extraHeaders);
  }
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
  return ozonRequest('/v1/dropoff-point/search', { filters, pagination });
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

export function postingLabel(postingNumber) {
  return ozonRequest('/v1/posting/label', { posting_number: postingNumber });
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
