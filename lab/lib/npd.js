// «Мой налог» (налог на профессиональный доход, lknpd.nalog.ru) — чеки самозанятого.
// Официального API для этого у ФНС нет: используется API веб-кабинета lknpd.nalog.ru (тот же, что
// у сайта и у open-source библиотек вроде moy-nalog). Если ФНС его поменяет — править здесь.
//
// Вход: по ИНН + паролю от ЛК налогоплательщика, либо по коду из СМС. Пароль не сохраняется —
// в настройках хранится только refresh-токен (им же обновляется короткоживущий access-токен).
import crypto from 'node:crypto';
import { getSetting, setSetting } from '../db.js';

const API = 'https://lknpd.nalog.ru/api';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

let accessToken = { value: '', expiresAt: 0 };

function deviceInfo() {
  let id = getSetting('npd_device_id');
  if (!id) {
    // Идентификатор «устройства» — постоянный для этой установки, как у браузера.
    id = crypto.randomBytes(11).toString('hex').slice(0, 21);
    setSetting('npd_device_id', id);
  }
  return { sourceDeviceId: id, sourceType: 'WEB', appVersion: '1.0.0', metaDetails: { userAgent: USER_AGENT } };
}

async function call(method, path, body, token) {
  const headers = { Accept: 'application/json, text/plain, */*', 'User-Agent': USER_AGENT, Referer: 'https://lknpd.nalog.ru/' };
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (err) {
    throw Object.assign(new Error(`Мой налог недоступен: ${err.cause?.code || err.message}`), { status: 502 });
  }
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) };
  }
  if (!res.ok) {
    // Кроме message ЛК иногда кладёт подробности в additionalInfo / exceptionMessage — показываем их тоже.
    const details = [data.exceptionMessage, data.additionalInfo && JSON.stringify(data.additionalInfo)]
      .filter((d) => d && d !== '{}' && d !== data.message)
      .join('; ');
    const err = new Error(`Мой налог: ${data.message || data.code || `HTTP ${res.status}`}${details ? ` (${details.slice(0, 300)})` : ''}`);
    console.error(`[npd] ${method} ${path} → HTTP ${res.status}: ${text.slice(0, 1000)}`);
    if (body && path !== '/v1/auth/lkfl' && path !== '/v1/auth/token') console.error(`[npd] запрос: ${JSON.stringify(body).slice(0, 2000)}`);
    err.status = res.status === 401 || res.status === 400 || res.status === 422 ? 400 : 502;
    err.httpStatus = res.status;
    throw err;
  }
  return data;
}

function saveSession(data) {
  if (!data?.token) throw new Error('Мой налог: не удалось войти — сервер не вернул токен');
  if (data.refreshToken) setSetting('npd_refresh_token', data.refreshToken);
  const inn = data.profile?.inn || getSetting('npd_inn');
  if (inn) setSetting('npd_inn', inn);
  const name = data.profile?.displayName || [data.profile?.lastName, data.profile?.firstName, data.profile?.middleName].filter(Boolean).join(' ');
  if (name) setSetting('npd_display_name', name);
  const ttl = Date.parse(data.tokenExpireIn || '') || Date.now() + 10 * 60 * 1000;
  accessToken = { value: data.token, expiresAt: ttl };
  return { inn, name };
}

// --- Вход -------------------------------------------------------------------------------------

export async function loginByPassword(inn, password) {
  const data = await call('POST', '/v1/auth/lkfl', { username: String(inn).trim(), password, deviceInfo: deviceInfo() });
  return saveSession(data);
}

export async function smsStart(phone) {
  const data = await call('POST', '/v2/auth/challenge/sms/start', { phone: String(phone).replace(/\D/g, ''), requireTpToBeActive: true });
  return { challengeToken: data.challengeToken, expireIn: data.expireIn };
}

export async function smsVerify(phone, code, challengeToken) {
  const data = await call('POST', '/v1/auth/challenge/sms/verify', {
    phone: String(phone).replace(/\D/g, ''),
    code: String(code).trim(),
    challengeToken,
    deviceInfo: deviceInfo(),
  });
  return saveSession(data);
}

export function logout() {
  setSetting('npd_refresh_token', '');
  setSetting('npd_display_name', '');
  accessToken = { value: '', expiresAt: 0 };
}

export function isConnected() {
  return Boolean(getSetting('npd_refresh_token') && getSetting('npd_inn'));
}

async function token() {
  if (accessToken.value && Date.now() < accessToken.expiresAt - 60_000) return accessToken.value;
  const refreshToken = getSetting('npd_refresh_token');
  if (!refreshToken) throw Object.assign(new Error('Войдите в «Мой налог» в Настройках → Мой налог'), { status: 400 });
  try {
    const data = await call('POST', '/v1/auth/token', { deviceInfo: deviceInfo(), refreshToken });
    saveSession(data);
    return accessToken.value;
  } catch (err) {
    if (err.httpStatus === 401 || err.httpStatus === 400) {
      throw Object.assign(new Error('Сессия «Мой налог» истекла — войдите заново в Настройках → Мой налог'), { status: 400 });
    }
    throw err;
  }
}

// --- Чеки ------------------------------------------------------------------------------------

// Время в формате, который ждёт ЛК: локальное время с часовым поясом, без миллисекунд.
export function localIso(date = new Date()) {
  const pad = (n) => String(Math.abs(Math.trunc(n))).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    + `${sign}${pad(offset / 60)}:${pad(offset % 60)}`;
}

// Название позиции: без переносов строк и управляющих символов, пробелы схлопнуты.
function cleanName(name) {
  return String(name || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 256);
}

// services: [{ name, amount (цена за единицу), quantity }]; paymentType: 'CASH' | 'ACCOUNT'.
export async function createIncome({ services, operationTime, paymentType = 'CASH' }) {
  const lines = services
    .map((s) => ({ name: cleanName(s.name), amount: Math.round(Number(s.amount) * 100) / 100, quantity: Math.max(1, Math.round(Number(s.quantity) || 1)) }))
    .filter((s) => s.name && s.amount > 0);
  if (!lines.length) throw Object.assign(new Error('В чеке нет позиций с суммой больше нуля'), { status: 400 });
  const totalCents = lines.reduce((sum, s) => sum + Math.round(s.amount * 100) * s.quantity, 0);
  const total = totalCents / 100;
  const send = async (type) => {
    const auth = await token();
    // requestTime — момент отправки (после обновления токена), operationTime не позже него.
    const now = new Date();
    const op = operationTime && operationTime < now ? operationTime : now;
    return call('POST', '/v1/income', {
      operationTime: localIso(op),
      requestTime: localIso(now),
      services: lines,
      totalAmount: total.toFixed(2),
      client: { contactPhone: null, displayName: null, incomeType: 'FROM_INDIVIDUAL', inn: null },
      paymentType: type,
      ignoreMaxTotalIncomeRestriction: false,
    }, auth);
  };
  let usedType = paymentType === 'ACCOUNT' ? 'ACCOUNT' : 'CASH';
  let data;
  try {
    data = await send(usedType);
  } catch (err) {
    // Чек физлицу с безналом ЛК может отклонить как «Неверный формат запроса» — все известные рабочие
    // клиенты шлют CASH. Ошибка 400 значит, что чек не создан, поэтому безопасно повторить с CASH.
    if (usedType !== 'ACCOUNT' || err.httpStatus !== 400) throw err;
    usedType = 'CASH';
    data = await send(usedType);
  }
  const uuid = data.approvedReceiptUuid;
  if (!uuid) throw new Error('Мой налог не вернул номер чека');
  return { uuid, total, url: receiptUrl(uuid), lines, payment_type: usedType };
}

// Ссылка на чек — публичная, её можно отправить покупателю.
export function receiptUrl(uuid, inn = getSetting('npd_inn')) {
  return `${API}/v1/receipt/${inn}/${uuid}/print`;
}

export const CANCEL_REASONS = {
  mistake: 'Чек сформирован ошибочно',
  refund: 'Возврат средств',
};

export async function cancelIncome(uuid, reason = 'mistake') {
  const now = localIso(new Date());
  await call('POST', '/v1/cancel', {
    operationTime: now,
    requestTime: now,
    comment: CANCEL_REASONS[reason] || CANCEL_REASONS.mistake,
    receiptUuid: uuid,
    partnerCode: null,
  }, await token());
}
