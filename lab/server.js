import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import db, {
  STATUSES,
  MODELS,
  COLORS,
  CONNECTORS,
  DELIVERY_SERVICES,
  listOrders,
  getOrder,
  createOrder,
  updateOrder,
  findSerialOwner,
  reorderBoardColumn,
  deleteOrder,
  createOrUpdateExternalOrder,
  markExternalOrderPaid,
  listSerials,
  generateSerial,
  colorLabel,
  connectorLabel,
  modelLabel,
  getItem,
  ensureAssembledAt,
  setItemAssembledAt,
  addReceipt,
  getReceipt,
  deleteReceipt,
  getSetting,
  setSetting,
  setOrderOzonParams,
  setOrderOzonDeliveryPoint,
  patchOrderOzonShipment,
  patchOrderCdekShipment,
  setOrderCdekPoint,
  setOrderNpdReceipt,
  listUsers,
  findUserById,
  createOrUpdateUser,
  updateUserPassword,
  deleteUser,
  verifyPassword,
  createSession,
  getSessionUser,
  deleteSession,
  LEDGER_CATEGORIES,
  getAccountingSettings,
  setAccountingSettings,
  listLedger,
  createLedgerEntry,
  updateLedgerEntry,
  deleteLedgerEntry,
  restoreOrderLedger,
  syncAllOrdersLedger,
  ledgerSummary,
  listDeliveryTopups,
  createDeliveryTopup,
  deleteDeliveryTopup,
  importLedgerRows,
  guessLedgerCategory,
  listSerialBook,
  findRegistrySerial,
  createRegistrySerial,
  updateRegistrySerial,
  deleteRegistrySerial,
  importRegistrySerials,
} from './db.js';
import { parseLedgerText } from './lib/ledger-import.js';
import { parseSerialsText } from './lib/serials-import.js';
import { buildLabelPdf } from './lib/label.js';
import * as ozon from './lib/ozon.js';
import * as cdek from './lib/cdek.js';
import * as npd from './lib/npd.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const uploadsDir = path.join(__dirname, 'data', 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
const PORT = process.env.PORT || 3000;
const MAX_RECEIPT_BYTES = 15 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function sendJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders });
  res.end(body);
}

const SESSION_COOKIE = 'lab_session';

function getCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

// Secure только за HTTPS (Caddy ставит x-forwarded-proto) — иначе локальная разработка по http сломается.
function sessionCookieHeader(req, token, expiresAt) {
  const secure = req.headers['x-forwarded-proto'] === 'https';
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function clearSessionCookieHeader(req) {
  const secure = req.headers['x-forwarded-proto'] === 'https';
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

// Статика и маршруты, доступные без входа: сама страница логина, её ресурсы,
// PWA-манифест/service worker (нужны браузеру ещё до логина), и машинный канал
// /api/external/* — у него своя авторизация по API-ключу (checkExternalAuth), не по сессии.
const PUBLIC_PATHS = new Set([
  '/login.html',
  '/style.css',
  '/app.js',
  '/manifest.webmanifest',
  '/sw.js',
  '/icon.svg',
  '/api/auth/login',
]);

function isPublicPath(pathname) {
  return PUBLIC_PATHS.has(pathname) || pathname.startsWith('/api/external/');
}

// Заказы из New_Lab_3d идут по отдельному "машинному" каналу (/api/external/*), не по /api/orders,
// которым пользуется собственный фронтенд lab. Ключ настраивается на лету через /api/integrations/settings;
// пока он не задан, канал открыт (как и весь остальной API lab сейчас) — иначе связка не заработает до первой настройки.
function checkExternalAuth(req) {
  const expected = getSetting('new_lab_api_key');
  if (!expected) return true;
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return token === expected;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = '';
    req.on('data', (c) => (chunks += c));
    req.on('end', () => {
      if (!chunks) return resolve({});
      try {
        resolve(JSON.parse(chunks));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function ordersToCsv(orders) {
  const header = [
    '№ заказа',
    'Дата',
    'Статус',
    'ТК',
    'Адрес ПВЗ',
    'ФИО',
    'Телефон',
    'Товары',
    'Сумма товаров',
    'Сумма доставки',
    'Итого',
  ];
  const statusLabel = (id) => STATUSES.find((s) => s.id === id)?.label || id;
  const lines = [header.map(csvEscape).join(';')];
  for (const o of orders) {
    const itemsStr = o.items
      .map(
        (it) =>
          `${it.product_name} x${it.quantity} (${colorLabel(it.color)}/${connectorLabel(it.connector)}) SN:${it.serial_number}`
      )
      .join(' | ');
    lines.push(
      [
        o.display_number,
        o.created_at,
        statusLabel(o.status),
        o.delivery_service,
        o.pvz_address,
        o.full_name,
        o.phone,
        itemsStr,
        o.goods_total.toFixed(2),
        o.delivery_price.toFixed(2),
        o.grand_total.toFixed(2),
      ]
        .map(csvEscape)
        .join(';')
    );
  }
  return '﻿' + lines.join('\r\n');
}

function ledgerToCsv(rows) {
  const header = ['Дата', 'Поступление', 'Списание', 'Назначение', 'Категория', 'Гарантия', 'Гарантия до', 'Налог', 'Доставка со счёта ТК', 'Заказ'];
  const lines = [header.map(csvEscape).join(';')];
  for (const r of rows) {
    lines.push(
      [
        r.date.split('-').reverse().join('.'),
        r.income ? String(r.income).replace('.', ',') : '',
        r.expense ? String(r.expense).replace('.', ',') : '',
        r.description,
        r.category,
        r.warranty ? 'да' : '',
        r.warranty_until ? r.warranty_until.split('-').reverse().join('.') : '',
        r.taxable ? 'да' : '',
        r.delivery_account ? 'да' : '',
        r.link_order_number ? `#${r.link_order_number}` : '',
      ]
        .map(csvEscape)
        .join(';')
    );
  }
  return '\ufeff' + lines.join('\r\n');
}

// Период из ?from=YYYY-MM-DD&to=YYYY-MM-DD (любая из дат может отсутствовать).
function periodParams(url) {
  const valid = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : undefined);
  return { from: valid(url.searchParams.get('from')), to: valid(url.searchParams.get('to')) };
}

// Строка из импорта уже есть в журнале (повторная вставка того же куска таблицы).
function isDuplicateLedgerRow(r) {
  return !!db
    .prepare('SELECT 1 FROM ledger WHERE date = ? AND income = ? AND expense = ? AND description = ? LIMIT 1')
    .get(r.date, r.income, r.expense, r.description);
}

// Как лист «Продажи»: #, С/Н, ревизия, цвет, разъём, дата сборки, примечание (+ заказ).
function serialsToCsv(rows) {
  const header = ['#', 'С / Н', 'Ревизия', 'Цвет', 'Разъем', 'Дата сборки', 'Прим.', 'Заказ', 'Клиент'];
  const lines = [header.map(csvEscape).join(';')];
  for (const r of rows) {
    lines.push(
      [
        r.number ?? '',
        r.serial,
        r.revision ?? '',
        r.color,
        r.connector,
        r.assembled_at ? r.assembled_at.split('-').reverse().join('.') : '',
        r.note,
        r.order_number ? `#${r.order_number}` : '',
        r.full_name,
      ]
        .map(csvEscape)
        .join(';')
    );
  }
  return '\ufeff' + lines.join('\r\n');
}

// Приводит любой ввод телефона к формату +7XXXXXXXXXX, которого требует Ozon Delivery API.
function normalizePhone(phone) {
  const digits = (phone || '').replace(/\D/g, '');
  if (!digits) return '';
  let d = digits;
  if (d.length === 11 && (d[0] === '7' || d[0] === '8')) d = '7' + d.slice(1);
  else if (d.length === 10) d = '7' + d;
  return `+${d}`;
}

function summarizeItemsForOzon(items) {
  const totals = new Map();
  for (const it of items) {
    const name = it.product_name || 'Товар';
    totals.set(name, (totals.get(name) || 0) + (Number(it.quantity) || 0));
  }
  return [...totals.entries()].map(([name, qty]) => (qty > 1 ? `${name} x${qty}` : name)).join(', ');
}

function ozonDeclaredValue(order) {
  return { amount: order.goods_total.toFixed(2), currency_code: 'RUB' };
}

// Шаблоны коробок: вес пустой коробки (с упаковкой) и габариты. Вес посылки = коробка + товары.
function readBoxTemplates() {
  try {
    const list = JSON.parse(getSetting('ozon_box_templates') || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function cleanBoxTemplates(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((t) => ({
      name: String(t?.name || '').trim(),
      weight_g: Math.round(Number(t?.weight_g) || 0),
      length_mm: Math.round(Number(t?.length_mm) || 0),
      width_mm: Math.round(Number(t?.width_mm) || 0),
      height_mm: Math.round(Number(t?.height_mm) || 0),
    }))
    .filter((t) => t.name);
}

// Каталог товаров для быстрого заполнения заказа: название, модель, цена, вес одной штуки.
function readProductTemplates() {
  try {
    const list = JSON.parse(getSetting('product_templates') || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function cleanProductTemplates(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((t) => ({
      name: String(t?.name || '').trim().slice(0, 120),
      model_id: MODELS.some((m) => m.id === t?.model_id) ? t.model_id : '',
      price: Math.max(0, Math.round((Number(t?.price) || 0) * 100) / 100),
      weight_g: Math.max(0, Math.round(Number(t?.weight_g) || 0)),
    }))
    .filter((t) => t.name);
}

// Список «Товар» в форме заказа — только каталог из Настроек → Каталог.
function catalogProducts() {
  return readProductTemplates().map((t) => ({ label: t.name, model_id: t.model_id, price: t.price, weight_g: t.weight_g }));
}

// Ozon отдаёт сумму объектом { amount: "123.00", currency_code: "RUB" } (иногда — числом/строкой),
// а сам расчёт может лежать в posting, в postings[0] или на верхнем уровне.
function ozonAmount(value) {
  if (value == null) return null;
  const n = Number(typeof value === 'object' ? value.amount ?? value.value : value);
  return Number.isFinite(n) ? n : null;
}

function ozonCheckoutCost(checkout) {
  const posting = checkout?.posting || checkout?.postings?.[0] || checkout || {};
  return ozonAmount(posting.estimated_delivery_cost ?? posting.delivery_cost ?? posting.price ?? checkout?.estimated_delivery_cost);
}

// Сумма доставки для покупателя: доставка Ozon + страховка (% от стоимости товаров).
function ozonDeliveryPriceFor(order, deliveryCost) {
  const percent = Number(String(getSetting('ozon_insurance_percent') || '0').replace(',', '.')) || 0;
  const insurance = (Number(order.goods_total) || 0) * percent / 100;
  return {
    delivery: deliveryCost,
    insurance: Math.round(insurance * 100) / 100,
    percent,
    total: Math.round((deliveryCost + insurance) * 100) / 100,
  };
}

// ---- «Мой налог» ----------------------------------------------------------------------------

// Позиции чека по шаблонам из настроек. Как в чеках вручную: одна строка на позицию заказа,
// «Название (Цвет/Разъём) - N шт» с суммой за всю позицию; доставка — «Доставка СДЭК».
const NPD_DEFAULT_ITEM_TEMPLATE = '{товар} ({цвет}/{разъём}) - {кол-во} шт';
const NPD_DEFAULT_DELIVERY_TEMPLATE = 'Доставка {служба}';

function fillTemplate(template, values) {
  return template
    .replace(/\{([^}]+)\}/g, (m, key) => (values[key.trim().toLowerCase()] ?? m))
    .replace(/\(\s*\/\s*\)|\(\s*\)/g, '') // пустые «( / )», если у товара нет цвета/разъёма
    .replace(/\(\s*\/\s*/g, '(').replace(/\s*\/\s*\)/g, ')')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function npdLinesFor(order) {
  const itemTemplate = getSetting('npd_item_template') || NPD_DEFAULT_ITEM_TEMPLATE;
  const deliveryTemplate = getSetting('npd_delivery_template') || NPD_DEFAULT_DELIVERY_TEMPLATE;
  const lines = order.items
    .filter((it) => Number(it.price) > 0 && Number(it.quantity) > 0)
    .map((it) => {
      const color = COLORS.find((c) => c.letter === it.color);
      const connector = CONNECTORS.find((c) => c.letter === it.connector);
      const qty = Number(it.quantity);
      return {
        name: fillTemplate(itemTemplate, {
          'товар': it.product_name || 'Товар',
          'цвет': color?.shortLabel || '',
          'разъём': connector?.label || '',
          'разъем': connector?.label || '',
          'кол-во': String(qty),
          'модель': it.model_id ? it.model_id.toUpperCase() : '',
          'серийник': it.serial_number || '',
        }),
        amount: Math.round(Number(it.price) * qty * 100) / 100,
        quantity: 1,
      };
    });
  if (getSetting('npd_include_delivery') !== '0' && Number(order.delivery_price) > 0) {
    lines.push({
      name: fillTemplate(deliveryTemplate, { 'служба': order.delivery_service || '' }) || 'Доставка',
      amount: Number(order.delivery_price),
      quantity: 1,
    });
  }
  return lines;
}

// ---- СДЭК ----------------------------------------------------------------------------------

const CDEK_DEFAULTS = { order_type: '2', tariff_code: '136', tariff_postamat: '368' };

function cdekSetting(key) {
  return getSetting(`cdek_${key}`) || CDEK_DEFAULTS[key] || '';
}

function cdekShipmentPoint() {
  try {
    const point = JSON.parse(getSetting('cdek_shipment_point') || 'null');
    if (point?.code) return point;
  } catch {
    // пусто
  }
  throw new Error('Выберите ПВЗ отправки в Настройках → СДЭК');
}

// Габариты для СДЭК: вес в граммах, стороны — в сантиметрах (из мм, с округлением вверх).
function cdekPackageSize(order) {
  const d = ozonDimensions(order);
  return {
    weight: d.weight_g,
    length: Math.ceil(d.length_mm / 10),
    width: Math.ceil(d.width_mm / 10),
    height: Math.ceil(d.height_mm / 10),
  };
}

function cdekTariffFor(point) {
  return Number(point?.type === 'POSTAMAT' ? cdekSetting('tariff_postamat') : cdekSetting('tariff_code'));
}

// ПВЗ получателя: выбранный вручную, иначе — подобранный по адресу (если совпадение однозначное).
async function cdekRecipientPoint(order) {
  const saved = order.cdek_shipment?.point;
  if (order.cdek_pvz_code && saved?.code === order.cdek_pvz_code) return saved;
  if (order.cdek_pvz_code) {
    const info = await cdek.pointInfo(order.cdek_pvz_code);
    if (!info) throw new Error(`ПВЗ СДЭК с кодом ${order.cdek_pvz_code} не найден`);
    setOrderCdekPoint(order.id, info);
    return info;
  }
  if (!order.pvz_address) throw new Error('Укажите адрес ПВЗ заказа или код ПВЗ СДЭК');
  const found = await cdek.findPointsByAddress(order.pvz_address, 2);
  if (!found.length) throw new Error(`ПВЗ СДЭК по адресу «${order.pvz_address}» не найден — проверьте адрес или укажите код ПВЗ`);
  const [best, second] = found;
  if (second && second.score >= best.score) {
    throw new Error('По адресу подходит несколько ПВЗ СДЭК — нажмите «Найти ПВЗ по адресу» и выберите нужный');
  }
  setOrderCdekPoint(order.id, best);
  return best;
}

function cdekInsuranceService(order) {
  return [{ code: 'INSURANCE', parameter: String(Math.round(Number(order.goods_total) || 0)) }];
}

// ware_key: только буквы, цифры и простые символы, до 50 знаков.
function cdekWareKey(it, index) {
  const raw = it.serial_number || it.model_id || `item-${it.id || index + 1}`;
  return String(raw).replace(/[^A-Za-zА-Яа-яЁё0-9_\-.]/g, '').slice(0, 50) || `item-${index + 1}`;
}

function cdekOrderBody(order, point) {
  const orderType = Number(cdekSetting('order_type')) === 1 ? 1 : 2;
  const size = cdekPackageSize(order);
  const items = order.items.filter((it) => Number(it.quantity) > 0);
  const totalQty = items.reduce((sum, it) => sum + Number(it.quantity), 0) || 1;
  const pkg = { number: `${order.id}-1`, ...size };
  if (orderType === 1) {
    // Интернет-магазин: товары обязательны; оплата при получении — 0 (заказ уже оплачен в ВК).
    pkg.items = items.map((it, i) => ({
      name: it.product_name || 'Товар',
      ware_key: cdekWareKey(it, i),
      payment: { value: 0 },
      cost: Number(it.price) || 0,
      weight: Math.max(1, Math.round(size.weight / totalQty)),
      amount: Number(it.quantity),
    }));
  } else {
    pkg.comment = summarizeItemsForOzon(order.items) || 'Товары';
  }
  const body = {
    type: orderType,
    tariff_code: cdekTariffFor(point),
    comment: `Заказ #${order.display_number}`,
    shipment_point: cdekShipmentPoint().code,
    delivery_point: point.code,
    recipient: {
      name: order.full_name || 'Получатель',
      phones: [{ number: normalizePhone(order.phone) }],
    },
    packages: [pkg],
  };
  if (orderType === 1) body.number = `order-${order.id}`;
  else {
    body.sender = {
      name: getSetting('cdek_sender_name') || 'Отправитель',
      phones: [{ number: normalizePhone(getSetting('cdek_sender_phone')) }],
    };
    if (!getSetting('cdek_sender_phone')) throw new Error('Укажите телефон отправителя в Настройках → СДЭК');
    body.services = cdekInsuranceService(order);
  }
  return body;
}

// Статусы СДЭК — массив; берём самый свежий. Ошибки валидации — в requests[].errors.
function cdekSummary(result) {
  const entity = result?.entity || {};
  const statuses = (entity.statuses || []).slice().sort((a, b) => String(b.date_time).localeCompare(String(a.date_time)));
  const errors = (result?.requests || []).flatMap((r) => (r.state === 'INVALID' ? r.errors || [] : []));
  return {
    uuid: entity.uuid,
    cdek_number: entity.cdek_number || null,
    status_code: statuses[0]?.code || null,
    status_name: statuses[0]?.name || null,
    status_at: statuses[0]?.date_time || null,
    errors: errors.map((e) => e.message || e.code),
    checked_at: new Date().toISOString(),
  };
}

function ozonDimensions(order) {
  // Ozon принимает только целые числа (Int32) — дробные значения округляем.
  const dims = {
    weight_g: Math.round(Number(order.weight_g) || 0),
    length_mm: Math.round(Number(order.length_mm) || 0),
    width_mm: Math.round(Number(order.width_mm) || 0),
    height_mm: Math.round(Number(order.height_mm) || 0),
  };
  if (Object.values(dims).some((v) => v < 1)) {
    throw new Error('Заполните вес (в граммах) и габариты посылки (в миллиметрах) в блоке «Ozon Доставка»');
  }
  return dims;
}

function ozonCutoffAt() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}

function ozonShipmentMethodId() {
  const id = getSetting('ozon_shipment_method_id');
  if (!id) throw new Error('Сначала настройте метод отгрузки в Настройках → Ozon Доставка');
  return Number(id);
}

// ID ПВЗ: введённый вручную, иначе — подбирается по адресу ПВЗ заказа и сохраняется в заказ.
async function ozonDeliveryPointId(order) {
  if (order.ozon_delivery_point_id) return Number(order.ozon_delivery_point_id);
  if (!order.pvz_address) throw new Error('Укажите адрес ПВЗ заказа или ID ПВЗ Ozon');
  const found = await ozon.findDeliveryPointsByAddress(order.pvz_address, 2);
  if (!found.length) throw new Error(`ПВЗ Ozon по адресу «${order.pvz_address}» не найден — проверьте адрес или укажите ID ПВЗ вручную`);
  const [best, second] = found;
  if (best.relaxed || (second && second.score >= best.score)) {
    throw new Error('ПВЗ Ozon по адресу не определён однозначно — нажмите «Найти ПВЗ по адресу» и выберите нужный');
  }
  setOrderOzonDeliveryPoint(order.id, best.delivery_point_id);
  return Number(best.delivery_point_id);
}

function serveStatic(req, res, pathname) {
  let filePath = path.join(publicDir, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Не найдено');
    }
    const ext = path.extname(filePath);
    // Страницы, скрипты и стили не кэшируем: после обновления браузер сразу берёт новую версию.
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    if (['.html', '.js', '.css', '.webmanifest'].includes(ext)) headers['Cache-Control'] = 'no-cache';
    res.writeHead(200, headers);
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  try {
    let user = null;
    if (!isPublicPath(pathname)) {
      user = getSessionUser(getCookie(req, SESSION_COOKIE));
      if (!user) {
        if (pathname.startsWith('/api/')) return sendJson(res, 401, { error: 'Требуется вход' });
        const next = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + url.search)}`;
        res.writeHead(302, { Location: `/login.html${next}` });
        return res.end();
      }
    }

    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const data = await readBody(req);
      const found = verifyPassword(String(data.username || '').trim(), String(data.password || ''));
      if (!found) return sendJson(res, 401, { error: 'Неверный логин или пароль' });
      const { token, expiresAt } = createSession(found.id);
      return sendJson(
        res,
        200,
        { id: found.id, username: found.username, role: found.role },
        { 'Set-Cookie': sessionCookieHeader(req, token, expiresAt) }
      );
    }

    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      const token = getCookie(req, SESSION_COOKIE);
      if (token) deleteSession(token);
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookieHeader(req) });
    }

    if (pathname === '/api/auth/me' && req.method === 'GET') {
      return sendJson(res, 200, { id: user.id, username: user.username, role: user.role });
    }

    if (pathname === '/api/users' && req.method === 'GET') {
      if (user.role !== 'admin') return sendJson(res, 403, { error: 'Доступно только администратору' });
      return sendJson(res, 200, listUsers());
    }

    if (pathname === '/api/users' && req.method === 'POST') {
      if (user.role !== 'admin') return sendJson(res, 403, { error: 'Доступно только администратору' });
      const data = await readBody(req);
      const username = String(data.username || '').trim();
      const password = String(data.password || '');
      if (!username || password.length < 6) {
        return sendJson(res, 400, { error: 'Логин обязателен, пароль — минимум 6 символов' });
      }
      const role = data.role === 'admin' ? 'admin' : 'employee';
      const created = createOrUpdateUser({ username, password, role });
      return sendJson(res, 201, created);
    }

    const userMatch = pathname.match(/^\/api\/users\/(\d+)$/);
    if (userMatch && req.method === 'PATCH') {
      if (user.role !== 'admin') return sendJson(res, 403, { error: 'Доступно только администратору' });
      const targetId = Number(userMatch[1]);
      const data = await readBody(req);
      if (data.password) {
        if (String(data.password).length < 6) return sendJson(res, 400, { error: 'Пароль — минимум 6 символов' });
        updateUserPassword(targetId, String(data.password));
      }
      const updated = findUserById(targetId);
      if (!updated) return sendJson(res, 404, { error: 'Пользователь не найден' });
      return sendJson(res, 200, updated);
    }

    if (userMatch && req.method === 'DELETE') {
      if (user.role !== 'admin') return sendJson(res, 403, { error: 'Доступно только администратору' });
      const targetId = Number(userMatch[1]);
      if (targetId === user.id) return sendJson(res, 400, { error: 'Нельзя удалить свою же учётную запись' });
      deleteUser(targetId);
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/statuses' && req.method === 'GET') {
      return sendJson(res, 200, STATUSES);
    }

    if (pathname === '/api/catalog' && req.method === 'GET') {
      return sendJson(res, 200, {
        models: MODELS,
        colors: COLORS,
        connectors: CONNECTORS,
        products: catalogProducts(),
        boxes: readBoxTemplates(),
        delivery_services: DELIVERY_SERVICES,
      });
    }

    if (pathname === '/api/serial' && req.method === 'POST') {
      const data = await readBody(req);
      try {
        const serial = generateSerial(data.model_id, data.color, data.connector, data.current_serial);
        return sendJson(res, 200, { serial });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    if (pathname === '/api/board/reorder' && req.method === 'POST') {
      const data = await readBody(req);
      const status = String(data.status || '');
      const ids = Array.isArray(data.ids) ? data.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
      if (!STATUSES.some((s) => s.id === status)) return sendJson(res, 400, { error: 'Неизвестный статус' });
      reorderBoardColumn(status, ids);
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/orders' && req.method === 'GET') {
      const status = url.searchParams.get('status') || undefined;
      const q = url.searchParams.get('q') || undefined;
      return sendJson(res, 200, listOrders({ status, q }));
    }

    if (pathname === '/api/orders' && req.method === 'POST') {
      const data = await readBody(req);
      return sendJson(res, 201, createOrder(data));
    }

    if (pathname === '/api/integrations/settings' && req.method === 'GET') {
      return sendJson(res, 200, { has_new_lab_api_key: !!getSetting('new_lab_api_key') });
    }

    if (pathname === '/api/integrations/settings' && req.method === 'POST') {
      const data = await readBody(req);
      if (data.new_lab_api_key != null) setSetting('new_lab_api_key', String(data.new_lab_api_key).trim());
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/external/orders' && req.method === 'POST') {
      if (!checkExternalAuth(req)) return sendJson(res, 401, { error: 'Неверный API-ключ' });
      const data = await readBody(req);
      if (!data.external_order_id) return sendJson(res, 400, { error: 'external_order_id обязателен' });
      return sendJson(res, 201, createOrUpdateExternalOrder(data));
    }

    const externalPaymentMatch = pathname.match(/^\/api\/external\/orders\/([^/]+)\/payment$/);
    if (externalPaymentMatch && req.method === 'PATCH') {
      if (!checkExternalAuth(req)) return sendJson(res, 401, { error: 'Неверный API-ключ' });
      const order = markExternalOrderPaid(decodeURIComponent(externalPaymentMatch[1]));
      if (!order) return sendJson(res, 404, { error: 'Заказ не найден' });
      return sendJson(res, 200, order);
    }

    const orderMatch = pathname.match(/^\/api\/orders\/(\d+)$/);
    if (orderMatch && req.method === 'GET') {
      const order = getOrder(Number(orderMatch[1]));
      if (!order) return sendJson(res, 404, { error: 'Заказ не найден' });
      return sendJson(res, 200, order);
    }
    if (orderMatch && req.method === 'PATCH') {
      const data = await readBody(req);
      const order = updateOrder(Number(orderMatch[1]), data);
      if (!order) return sendJson(res, 404, { error: 'Заказ не найден' });
      return sendJson(res, 200, order);
    }
    if (orderMatch && req.method === 'DELETE') {
      deleteOrder(Number(orderMatch[1]));
      return sendJson(res, 200, { ok: true });
    }

    // Проверка серийника «на лету» из формы заказа.
    if (pathname === '/api/serials/check' && req.method === 'GET') {
      const owner = findSerialOwner(url.searchParams.get('serial'), {
        excludeOrderId: Number(url.searchParams.get('order_id')) || null,
      });
      return sendJson(res, 200, { taken: !!owner, order_id: owner?.order_id ?? null, order_number: owner?.order_number ?? null });
    }

    if (pathname === '/api/serials' && req.method === 'GET') {
      return sendJson(res, 200, listSerials());
    }

    // Книга серийных номеров (как лист «Продажи»): заказы + реестр номеров из таблицы.
    if (pathname === '/api/serials/book' && req.method === 'GET') {
      return sendJson(res, 200, listSerialBook());
    }

    if (pathname === '/api/serials/registry' && req.method === 'POST') {
      return sendJson(res, 201, createRegistrySerial(await readBody(req)));
    }

    const registryMatch = pathname.match(/^\/api\/serials\/registry\/(\d+)$/);
    if (registryMatch && req.method === 'PATCH') {
      const row = updateRegistrySerial(Number(registryMatch[1]), await readBody(req));
      if (!row) return sendJson(res, 404, { error: 'Номер не найден' });
      return sendJson(res, 200, row);
    }
    if (registryMatch && req.method === 'DELETE') {
      if (!deleteRegistrySerial(Number(registryMatch[1]))) return sendJson(res, 404, { error: 'Номер не найден' });
      return sendJson(res, 200, { ok: true });
    }

    // Импорт листа «Продажи»: предпросмотр (commit: false), потом запись.
    if (pathname === '/api/serials/import' && req.method === 'POST') {
      const data = await readBody(req);
      const { rows, errors } = parseSerialsText(data.text);
      const seen = new Set();
      const prepared = rows.map((r) => {
        const inRegistry = findRegistrySerial(r.serial);
        const owner = findSerialOwner(r.serial);
        const number = Number(r.serial.slice(-4));
        const repeated = seen.has(number);
        seen.add(number);
        return {
          ...r,
          number,
          duplicate: !!(inRegistry || owner || repeated),
          reason: inRegistry ? 'уже в реестре' : owner ? `в заказе #${owner.order_number}` : repeated ? 'номер повторяется' : '',
        };
      });
      const fresh = prepared.filter((r) => !r.duplicate).length;
      if (!data.commit) return sendJson(res, 200, { rows: prepared, errors, new_count: fresh });
      const imported = importRegistrySerials(prepared);
      return sendJson(res, 200, { imported, skipped: prepared.length - imported, errors });
    }

    const itemMatch = pathname.match(/^\/api\/items\/(\d+)$/);
    if (itemMatch && req.method === 'PATCH') {
      const data = await readBody(req);
      const ok = setItemAssembledAt(Number(itemMatch[1]), data.assembled_at);
      if (!ok) return sendJson(res, 404, { error: 'Товар не найден' });
      return sendJson(res, 200, { ok: true });
    }

    const labelMatch = pathname.match(/^\/api\/items\/(\d+)\/label\.pdf$/);
    if (labelMatch && req.method === 'GET') {
      const itemId = Number(labelMatch[1]);
      const found = getItem(itemId);
      if (!found) return sendJson(res, 404, { error: 'Товар не найден' });
      const { item } = found;
      const model = MODELS.find((m) => m.id === item.model_id);
      if (!model || !item.color || !item.connector || !item.serial_number) {
        return sendJson(res, 400, {
          error: 'Для этикетки нужно заполнить и сохранить модель, цвет, разъём и серийный номер',
        });
      }
      // Дата сборки фиксируется при первом скачивании этикетки, если её ещё не вводили вручную.
      const assembledAt = ensureAssembledAt(itemId, new Date().toISOString().slice(0, 10));
      const pdf = await buildLabelPdf({ item, model, assembledAt });
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${item.serial_number}.pdf"`,
      });
      return res.end(pdf);
    }

    const receiptsMatch = pathname.match(/^\/api\/orders\/(\d+)\/receipts$/);
    if (receiptsMatch && req.method === 'POST') {
      const orderId = Number(receiptsMatch[1]);
      if (!getOrder(orderId)) return sendJson(res, 404, { error: 'Заказ не найден' });
      const data = await readBody(req);
      if (!data.filename || !data.dataBase64) {
        return sendJson(res, 400, { error: 'Нужны filename и dataBase64' });
      }
      const buffer = Buffer.from(data.dataBase64, 'base64');
      if (buffer.length > MAX_RECEIPT_BYTES) {
        return sendJson(res, 400, { error: 'Файл больше 15МБ' });
      }
      const safeExt = (path.extname(data.filename) || '').replace(/[^a-zA-Z0-9.]/g, '').slice(0, 10);
      const fileName = `${crypto.randomUUID()}${safeExt}`;
      fs.writeFileSync(path.join(uploadsDir, fileName), buffer);
      const receipt = addReceipt(orderId, {
        fileName,
        originalName: data.filename,
        mimeType: data.mimeType || 'application/octet-stream',
      });
      return sendJson(res, 201, receipt);
    }

    const receiptFileMatch = pathname.match(/^\/api\/receipts\/(\d+)\/file$/);
    if (receiptFileMatch && req.method === 'GET') {
      const receipt = getReceipt(Number(receiptFileMatch[1]));
      if (!receipt) return sendJson(res, 404, { error: 'Чек не найден' });
      const filePath = path.join(uploadsDir, receipt.file_name);
      fs.readFile(filePath, (err, buf) => {
        if (err) return sendJson(res, 404, { error: 'Файл не найден на диске' });
        res.writeHead(200, {
          'Content-Type': receipt.mime_type,
          'Content-Disposition': `inline; filename="${encodeURIComponent(receipt.original_name)}"`,
        });
        res.end(buf);
      });
      return;
    }

    const receiptMatch = pathname.match(/^\/api\/receipts\/(\d+)$/);
    if (receiptMatch && req.method === 'DELETE') {
      const receipt = deleteReceipt(Number(receiptMatch[1]));
      if (!receipt) return sendJson(res, 404, { error: 'Чек не найден' });
      fs.unlink(path.join(uploadsDir, receipt.file_name), () => {});
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/ozon/settings' && req.method === 'GET') {
      return sendJson(res, 200, {
        client_id: getSetting('ozon_client_id'),
        has_secret: !!getSetting('ozon_client_secret'),
        shipment_method_id: getSetting('ozon_shipment_method_id'),
        insurance_percent: getSetting('ozon_insurance_percent'),
      });
    }

    if (pathname === '/api/ozon/settings' && req.method === 'POST') {
      const data = await readBody(req);
      if (data.client_id != null) setSetting('ozon_client_id', String(data.client_id).trim());
      if (data.client_secret) setSetting('ozon_client_secret', String(data.client_secret).trim());
      if (data.shipment_method_id != null) setSetting('ozon_shipment_method_id', String(data.shipment_method_id).trim());
      if (data.insurance_percent != null) setSetting('ozon_insurance_percent', String(data.insurance_percent).replace(',', '.').trim());
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/catalog/products' && req.method === 'GET') {
      return sendJson(res, 200, { templates: readProductTemplates() });
    }

    if (pathname === '/api/catalog/products' && req.method === 'PUT') {
      const data = await readBody(req);
      const templates = cleanProductTemplates(data.templates);
      setSetting('product_templates', JSON.stringify(templates));
      return sendJson(res, 200, { templates });
    }

    if ((pathname === '/api/ozon/box-templates' || pathname === '/api/catalog/boxes') && req.method === 'GET') {
      return sendJson(res, 200, { templates: readBoxTemplates() });
    }

    if ((pathname === '/api/ozon/box-templates' || pathname === '/api/catalog/boxes') && req.method === 'PUT') {
      const data = await readBody(req);
      const templates = cleanBoxTemplates(data.templates);
      setSetting('ozon_box_templates', JSON.stringify(templates));
      return sendJson(res, 200, { templates });
    }

    if (pathname === '/api/ozon/shipment-methods' && req.method === 'GET') {
      try {
        const result = await ozon.searchShipmentMethods({}, { limit: 100 });
        return sendJson(res, 200, { shipment_methods: result.shipment_methods || [] });
      } catch (err) {
        return sendJson(res, 502, { error: err.message });
      }
    }

    if (pathname === '/api/ozon/shipment-method' && req.method === 'GET') {
      const id = getSetting('ozon_shipment_method_id');
      if (!id) return sendJson(res, 200, { shipment_method: null });
      try {
        const result = await ozon.shipmentMethodInfo([Number(id)]);
        return sendJson(res, 200, { shipment_method: result.shipment_methods?.[0] || null });
      } catch (err) {
        return sendJson(res, 502, { error: err.message });
      }
    }

    if (pathname === '/api/ozon/delivery-points/find' && req.method === 'POST') {
      const data = await readBody(req);
      try {
        const points = await ozon.findDeliveryPointsByAddress(String(data.address || ''), 5);
        return sendJson(res, 200, { delivery_points: points });
      } catch (err) {
        return sendJson(res, 502, { error: err.message });
      }
    }

    if (pathname === '/api/ozon/delivery-point/info' && req.method === 'POST') {
      const data = await readBody(req);
      try {
        const result = await ozon.deliveryPointInfo([Number(data.delivery_point_id)]);
        return sendJson(res, 200, { delivery_point: result.delivery_points?.[0] || null });
      } catch (err) {
        return sendJson(res, 502, { error: err.message });
      }
    }

    const ozonParamsMatch = pathname.match(/^\/api\/orders\/(\d+)\/ozon$/);
    if (ozonParamsMatch && req.method === 'PATCH') {
      const data = await readBody(req);
      const order = setOrderOzonParams(Number(ozonParamsMatch[1]), data);
      if (!order) return sendJson(res, 404, { error: 'Заказ не найден' });
      return sendJson(res, 200, order);
    }

    const ozonCheckoutMatch = pathname.match(/^\/api\/orders\/(\d+)\/ozon\/checkout$/);
    if (ozonCheckoutMatch && req.method === 'POST') {
      const orderId = Number(ozonCheckoutMatch[1]);
      const order = getOrder(orderId);
      if (!order) return sendJson(res, 404, { error: 'Заказ не найден' });
      try {
        const payload = {
          recipient: { phone_number: normalizePhone(order.phone) },
          postings: [
            {
              request_id: order.id,
              shipment_method_id: ozonShipmentMethodId(),
              cutoff_at: ozonCutoffAt(),
              declared_value: ozonDeclaredValue(order),
              dimensions: ozonDimensions(order),
            },
          ],
          delivery: { delivery_point: { delivery_point_id: await ozonDeliveryPointId(order) } },
        };
        const result = await ozon.orderCheckout(payload);
        const checkout = result.results?.[0] || result;
        const cost = ozonCheckoutCost(checkout);
        const price = cost != null ? ozonDeliveryPriceFor(order, cost) : null;
        // Расчёт сразу проставляем в «Сумму доставки» заказа (доставка Ozon + страховка).
        if (price) updateOrder(orderId, { delivery_price: price.total });
        const updated = patchOrderOzonShipment(orderId, {
          checkout,
          price,
          checked_out_at: new Date().toISOString(),
        });
        return sendJson(res, 200, updated);
      } catch (err) {
        return sendJson(res, 502, { error: err.message });
      }
    }

    const ozonCreateMatch = pathname.match(/^\/api\/orders\/(\d+)\/ozon\/create$/);
    if (ozonCreateMatch && req.method === 'POST') {
      const orderId = Number(ozonCreateMatch[1]);
      const order = getOrder(orderId);
      if (!order) return sendJson(res, 404, { error: 'Заказ не найден' });
      try {
        const payload = {
          order_external_id: `order-${order.id}`,
          recipient: { phone_number: normalizePhone(order.phone), full_name: order.full_name || '' },
          delivery: { delivery_point: { delivery_point_id: await ozonDeliveryPointId(order) } },
          postings: [
            {
              request_id: order.id,
              posting_external_id: `order-${order.id}-1`,
              shipment_method_id: ozonShipmentMethodId(),
              description: summarizeItemsForOzon(order.items),
              declared_value: ozonDeclaredValue(order),
              cutoff_at: ozonCutoffAt(),
              dimensions: ozonDimensions(order),
            },
          ],
        };
        const result = await ozon.orderCreate(payload, crypto.randomUUID());
        const posting = result.postings?.[0];
        const updated = patchOrderOzonShipment(orderId, {
          order_number: result.order_number,
          order_external_id: result.order_external_id,
          posting_number: posting?.posting_number,
          posting_external_id: posting?.posting_external_id,
          estimated_delivery_days: posting?.estimated_delivery_days,
          cutoff_at: posting?.cutoff_at,
          status: 'created',
          created_at: new Date().toISOString(),
        });
        return sendJson(res, 200, updated);
      } catch (err) {
        return sendJson(res, 502, { error: err.message });
      }
    }

    const ozonApproveMatch = pathname.match(/^\/api\/orders\/(\d+)\/ozon\/approve$/);
    if (ozonApproveMatch && req.method === 'POST') {
      const orderId = Number(ozonApproveMatch[1]);
      const order = getOrder(orderId);
      if (!order) return sendJson(res, 404, { error: 'Заказ не найден' });
      const postingNumber = order.ozon_shipment?.posting_number;
      if (!postingNumber) return sendJson(res, 400, { error: 'Сначала создайте черновик заказа в Ozon' });
      try {
        await ozon.postingApprove(postingNumber);
        const updated = patchOrderOzonShipment(orderId, { status: 'approved', approved_at: new Date().toISOString() });
        return sendJson(res, 200, updated);
      } catch (err) {
        return sendJson(res, 502, { error: err.message });
      }
    }

    const ozonStatusMatch = pathname.match(/^\/api\/orders\/(\d+)\/ozon\/status$/);
    if (ozonStatusMatch && req.method === 'POST') {
      const orderId = Number(ozonStatusMatch[1]);
      const order = getOrder(orderId);
      if (!order) return sendJson(res, 404, { error: 'Заказ не найден' });
      const postingNumber = order.ozon_shipment?.posting_number;
      if (!postingNumber) return sendJson(res, 400, { error: 'У заказа ещё нет отправления Ozon' });
      try {
        const result = await ozon.postingInfo([postingNumber]);
        const posting = result.postings?.[0];
        const updated = patchOrderOzonShipment(orderId, {
          live_status: posting?.status,
          live_status_checked_at: new Date().toISOString(),
        });
        return sendJson(res, 200, updated);
      } catch (err) {
        return sendJson(res, 502, { error: err.message });
      }
    }

    // ---- «Мой налог» ----
    if (pathname === '/api/npd/settings' && req.method === 'GET') {
      return sendJson(res, 200, {
        connected: npd.isConnected(),
        inn: getSetting('npd_inn'),
        name: getSetting('npd_display_name'),
        payment_type: getSetting('npd_payment_type') || 'ACCOUNT',
        include_delivery: getSetting('npd_include_delivery') !== '0',
        item_template: getSetting('npd_item_template') || NPD_DEFAULT_ITEM_TEMPLATE,
        delivery_template: getSetting('npd_delivery_template') || NPD_DEFAULT_DELIVERY_TEMPLATE,
      });
    }

    if (pathname === '/api/npd/settings' && req.method === 'POST') {
      const data = await readBody(req);
      if (data.payment_type != null) setSetting('npd_payment_type', data.payment_type === 'CASH' ? 'CASH' : 'ACCOUNT');
      if (data.include_delivery != null) setSetting('npd_include_delivery', data.include_delivery ? '1' : '0');
      if (data.item_template != null) setSetting('npd_item_template', String(data.item_template).trim().slice(0, 200));
      if (data.delivery_template != null) setSetting('npd_delivery_template', String(data.delivery_template).trim().slice(0, 200));
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/npd/login' && req.method === 'POST') {
      const data = await readBody(req);
      if (!data.inn || !data.password) return sendJson(res, 400, { error: 'Введите ИНН и пароль' });
      return sendJson(res, 200, await npd.loginByPassword(data.inn, data.password));
    }

    if (pathname === '/api/npd/sms/start' && req.method === 'POST') {
      const data = await readBody(req);
      if (!data.phone) return sendJson(res, 400, { error: 'Введите номер телефона' });
      return sendJson(res, 200, await npd.smsStart(data.phone));
    }

    if (pathname === '/api/npd/sms/verify' && req.method === 'POST') {
      const data = await readBody(req);
      if (!data.phone || !data.code || !data.challenge_token) return sendJson(res, 400, { error: 'Введите код из СМС' });
      return sendJson(res, 200, await npd.smsVerify(data.phone, data.code, data.challenge_token));
    }

    if (pathname === '/api/npd/logout' && req.method === 'POST') {
      npd.logout();
      return sendJson(res, 200, { ok: true });
    }

    const npdMatch = pathname.match(/^\/api\/orders\/(\d+)\/npd\/(preview|receipt|cancel)$/);
    if (npdMatch) {
      const orderId = Number(npdMatch[1]);
      const order = getOrder(orderId);
      if (!order) return sendJson(res, 404, { error: 'Заказ не найден' });
      const current = order.npd_receipt;
      const active = current?.uuid && !current.canceled_at;

      if (npdMatch[2] === 'preview' && req.method === 'GET') {
        const lines = npdLinesFor(order);
        return sendJson(res, 200, { lines, total: lines.reduce((sum, l) => sum + l.amount * l.quantity, 0) });
      }

      if (npdMatch[2] === 'receipt' && req.method === 'POST') {
        if (active) return sendJson(res, 400, { error: 'Чек по этому заказу уже сформирован' });
        const data = await readBody(req);
        // Дата расчёта — из формы (по умолчанию сегодня); время ставим текущее.
        let operationTime = new Date();
        if (/^\d{4}-\d{2}-\d{2}$/.test(data.date || '')) {
          const [y, m, d] = data.date.split('-').map(Number);
          operationTime = new Date(y, m - 1, d, operationTime.getHours(), operationTime.getMinutes(), operationTime.getSeconds());
          if (operationTime > new Date()) return sendJson(res, 400, { error: 'Дата расчёта не может быть в будущем' });
        }
        // Названия строк можно поправить в предпросмотре; суммы — только из заказа.
        const services = npdLinesFor(order);
        if (Array.isArray(data.names) && data.names.length === services.length) {
          services.forEach((line, i) => {
            const name = String(data.names[i] || '').trim();
            if (name) line.name = name.slice(0, 256);
          });
        }
        const receipt = await npd.createIncome({
          services,
          operationTime,
          paymentType: getSetting('npd_payment_type') || 'ACCOUNT',
        });
        return sendJson(res, 200, setOrderNpdReceipt(orderId, {
          ...receipt,
          operation_date: npd.localIso(operationTime).slice(0, 10),
          created_at: new Date().toISOString(),
        }));
      }

      if (npdMatch[2] === 'cancel' && req.method === 'POST') {
        if (!active) return sendJson(res, 400, { error: 'Действующего чека по заказу нет' });
        const data = await readBody(req);
        const reason = data.reason === 'refund' ? 'refund' : 'mistake';
        await npd.cancelIncome(current.uuid, reason);
        return sendJson(res, 200, setOrderNpdReceipt(orderId, {
          ...current,
          canceled_at: new Date().toISOString(),
          cancel_reason: npd.CANCEL_REASONS[reason],
        }));
      }
      return sendJson(res, 405, { error: 'Метод не поддерживается' });
    }

    // ---- СДЭК ----
    if (pathname === '/api/cdek/settings' && req.method === 'GET') {
      let shipmentPoint = null;
      try {
        shipmentPoint = JSON.parse(getSetting('cdek_shipment_point') || 'null');
      } catch {
        shipmentPoint = null;
      }
      return sendJson(res, 200, {
        client_id: getSetting('cdek_client_id'),
        has_secret: !!getSetting('cdek_client_secret'),
        test_mode: getSetting('cdek_test_mode') === '1',
        order_type: cdekSetting('order_type'),
        tariff_code: cdekSetting('tariff_code'),
        tariff_postamat: cdekSetting('tariff_postamat'),
        sender_name: getSetting('cdek_sender_name'),
        sender_phone: getSetting('cdek_sender_phone'),
        shipment_point: shipmentPoint,
      });
    }

    if (pathname === '/api/cdek/settings' && req.method === 'POST') {
      const data = await readBody(req);
      const str = (v) => String(v ?? '').trim();
      if (data.client_id != null) setSetting('cdek_client_id', str(data.client_id));
      if (data.client_secret) setSetting('cdek_client_secret', str(data.client_secret));
      if (data.test_mode != null) setSetting('cdek_test_mode', data.test_mode ? '1' : '0');
      for (const key of ['order_type', 'tariff_code', 'tariff_postamat', 'sender_name', 'sender_phone']) {
        if (data[key] != null) setSetting(`cdek_${key}`, str(data[key]));
      }
      if (data.shipment_point !== undefined) {
        const p = data.shipment_point;
        setSetting('cdek_shipment_point', p?.code ? JSON.stringify({
          code: String(p.code), full_address: p.full_address || '', city_code: p.city_code ?? null, type: p.type || '',
        }) : '');
      }
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/cdek/points/find' && req.method === 'POST') {
      const data = await readBody(req);
      try {
        const purpose = data.purpose === 'reception' ? 'reception' : 'handout';
        const points = await cdek.findPointsByAddress(String(data.address || ''), 8, purpose);
        return sendJson(res, 200, { points });
      } catch (err) {
        return sendJson(res, 502, { error: err.message });
      }
    }

    const cdekMatch = pathname.match(/^\/api\/orders\/(\d+)\/cdek\/(point|calculate|create|status|cancel|label\.pdf)$/);
    if (cdekMatch) {
      const orderId = Number(cdekMatch[1]);
      const action = cdekMatch[2];
      const order = getOrder(orderId);
      if (!order) return sendJson(res, 404, { error: 'Заказ не найден' });
      const uuid = order.cdek_shipment?.uuid;
      try {
        if (action === 'point' && req.method === 'PUT') {
          const data = await readBody(req);
          if (!data.code) return sendJson(res, 200, setOrderCdekPoint(orderId, null));
          const point = data.full_address ? data : await cdek.pointInfo(String(data.code));
          if (!point) return sendJson(res, 404, { error: `ПВЗ СДЭК с кодом ${data.code} не найден` });
          return sendJson(res, 200, setOrderCdekPoint(orderId, {
            code: String(point.code), full_address: point.full_address || '', city_code: point.city_code ?? null,
            type: point.type || '', name: point.name || '',
          }));
        }

        if (action === 'calculate' && req.method === 'POST') {
          const point = await cdekRecipientPoint(order);
          const from = cdekShipmentPoint();
          const body = {
            tariff_code: cdekTariffFor(point),
            from_location: from.city_code ? { code: Number(from.city_code) } : undefined,
            to_location: point.city_code ? { code: Number(point.city_code) } : undefined,
            shipment_point: from.code,
            delivery_point: point.code,
            packages: [cdekPackageSize(order)],
            services: cdekInsuranceService(order),
          };
          const result = await cdek.calculateTariff(body);
          if (result.errors?.length) throw new Error(`СДЭК расчёт: ${result.errors.map((e) => e.message).join('; ')}`);
          const deliverySum = Number(result.delivery_sum) || 0;
          const total = Number(result.total_sum ?? deliverySum);
          const insurance = (result.services || []).filter((x) => x.code === 'INSURANCE')
            .reduce((sum, x) => sum + Number(x.total_sum ?? x.sum ?? 0), 0);
          const price = {
            delivery: Math.round((total - insurance) * 100) / 100,
            insurance: Math.round(insurance * 100) / 100,
            total: Math.round(total * 100) / 100,
            period_min: result.period_min ?? null,
            period_max: result.period_max ?? null,
            tariff_code: body.tariff_code,
          };
          updateOrder(orderId, { delivery_price: price.total });
          return sendJson(res, 200, patchOrderCdekShipment(orderId, { price, calculated_at: new Date().toISOString() }));
        }

        if (action === 'create' && req.method === 'POST') {
          if (uuid && !order.cdek_shipment?.cancelled_at && !order.cdek_shipment?.errors?.length) {
            return sendJson(res, 400, { error: 'Заказ в СДЭК уже создан' });
          }
          const point = await cdekRecipientPoint(order);
          const result = await cdek.createOrder(cdekOrderBody(getOrder(orderId), point));
          const newUuid = result?.entity?.uuid;
          if (!newUuid) throw new Error('СДЭК не вернул идентификатор заказа');
          patchOrderCdekShipment(orderId, {
            uuid: newUuid, cdek_number: null, errors: [], cancelled_at: null, created_at: new Date().toISOString(),
          });
          // Заказ СДЭК обрабатывает асинхронно — через пару секунд уже видны номер или ошибки.
          await new Promise((r) => setTimeout(r, 1500));
          const info = await cdek.getOrder(newUuid).catch(() => null);
          return sendJson(res, 200, info ? patchOrderCdekShipment(orderId, cdekSummary(info)) : getOrder(orderId));
        }

        if (action === 'status' && req.method === 'POST') {
          if (!uuid) return sendJson(res, 400, { error: 'Заказ в СДЭК ещё не создан' });
          const info = await cdek.getOrder(uuid);
          return sendJson(res, 200, patchOrderCdekShipment(orderId, cdekSummary(info)));
        }

        if (action === 'cancel' && req.method === 'POST') {
          if (!uuid) return sendJson(res, 400, { error: 'Заказ в СДЭК ещё не создан' });
          await cdek.deleteOrder(uuid);
          return sendJson(res, 200, patchOrderCdekShipment(orderId, {
            uuid: null, cdek_number: null, status_code: null, status_name: null, errors: [], cancelled_at: new Date().toISOString(),
          }));
        }

        if (action === 'label.pdf' && req.method === 'GET') {
          if (!uuid) return sendJson(res, 400, { error: 'Сначала создайте заказ в СДЭК' });
          const buffer = await cdek.barcodePdf(uuid, 'A6');
          patchOrderCdekShipment(orderId, { label_downloaded_at: new Date().toISOString() });
          res.writeHead(200, {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="cdek-${order.cdek_shipment?.cdek_number || orderId}.pdf"`,
          });
          return res.end(buffer);
        }
      } catch (err) {
        return sendJson(res, 502, { error: err.message });
      }
      return sendJson(res, 405, { error: 'Метод не поддерживается' });
    }

    const ozonLabelMatch = pathname.match(/^\/api\/orders\/(\d+)\/ozon\/label\.pdf$/);
    if (ozonLabelMatch && req.method === 'GET') {
      const orderId = Number(ozonLabelMatch[1]);
      const order = getOrder(orderId);
      if (!order) return sendJson(res, 404, { error: 'Заказ не найден' });
      const postingNumber = order.ozon_shipment?.posting_number;
      if (!postingNumber) return sendJson(res, 400, { error: 'Сначала создайте черновик заказа в Ozon' });
      try {
        const { buffer, contentType } = await ozon.postingLabelFile(postingNumber);
        patchOrderOzonShipment(orderId, { label_downloaded_at: new Date().toISOString() });
        const ext = /png/i.test(contentType) ? 'png' : /zpl|text/i.test(contentType) ? 'txt' : 'pdf';
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Disposition': `inline; filename="${postingNumber}.${ext}"`,
        });
        return res.end(buffer);
      } catch (err) {
        return sendJson(res, 502, { error: err.message });
      }
    }

    // ---- Бухгалтерия (только администратор) ----
    if (pathname.startsWith('/api/accounting/') || pathname === '/api/export/ledger.csv') {
      if (user.role !== 'admin') return sendJson(res, 403, { error: 'Бухгалтерия доступна только администратору' });
    }

    if (pathname === '/api/accounting/settings' && req.method === 'GET') {
      return sendJson(res, 200, { ...getAccountingSettings(), categories: LEDGER_CATEGORIES });
    }

    if (pathname === '/api/accounting/settings' && req.method === 'POST') {
      const data = await readBody(req);
      const before = getAccountingSettings();
      const saved = setAccountingSettings(data);
      // Сменили дату начала автозаполнения — пересобрать продажи из заказов.
      if (saved.auto_since !== before.auto_since) syncAllOrdersLedger();
      return sendJson(res, 200, { ...saved, categories: LEDGER_CATEGORIES });
    }

    if (pathname === '/api/accounting/ledger' && req.method === 'GET') {
      return sendJson(res, 200, listLedger({
        ...periodParams(url),
        q: url.searchParams.get('q') || undefined,
        orderId: Number(url.searchParams.get('order_id')) || undefined,
      }));
    }

    if (pathname === '/api/accounting/ledger' && req.method === 'POST') {
      return sendJson(res, 201, createLedgerEntry(await readBody(req)));
    }

    const ledgerMatch = pathname.match(/^\/api\/accounting\/ledger\/(\d+)$/);
    if (ledgerMatch && req.method === 'PATCH') {
      const entry = updateLedgerEntry(Number(ledgerMatch[1]), await readBody(req));
      if (!entry) return sendJson(res, 404, { error: 'Запись не найдена' });
      return sendJson(res, 200, entry);
    }
    if (ledgerMatch && req.method === 'DELETE') {
      if (!deleteLedgerEntry(Number(ledgerMatch[1]))) return sendJson(res, 404, { error: 'Запись не найдена' });
      return sendJson(res, 200, { ok: true });
    }

    const ledgerRestoreMatch = pathname.match(/^\/api\/accounting\/orders\/(\d+)\/restore$/);
    if (ledgerRestoreMatch && req.method === 'POST') {
      restoreOrderLedger(Number(ledgerRestoreMatch[1]));
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/accounting/summary' && req.method === 'GET') {
      return sendJson(res, 200, ledgerSummary(periodParams(url)));
    }

    if (pathname === '/api/accounting/sync' && req.method === 'POST') {
      return sendJson(res, 200, { orders: syncAllOrdersLedger() });
    }

    if (pathname === '/api/accounting/topups' && req.method === 'GET') {
      return sendJson(res, 200, listDeliveryTopups());
    }
    if (pathname === '/api/accounting/topups' && req.method === 'POST') {
      return sendJson(res, 201, createDeliveryTopup(await readBody(req)));
    }
    const topupMatch = pathname.match(/^\/api\/accounting\/topups\/(\d+)$/);
    if (topupMatch && req.method === 'DELETE') {
      if (!deleteDeliveryTopup(Number(topupMatch[1]))) return sendJson(res, 404, { error: 'Запись не найдена' });
      return sendJson(res, 200, { ok: true });
    }

    // Импорт из Google-таблицы: сначала предпросмотр (commit: false), потом запись.
    if (pathname === '/api/accounting/import' && req.method === 'POST') {
      const data = await readBody(req);
      const { rows, errors } = parseLedgerText(data.text);
      const prepared = rows.map((r) => ({
        ...r,
        category: r.category || guessLedgerCategory(r.description, r.income),
        duplicate: isDuplicateLedgerRow(r),
      }));
      const fresh = prepared.filter((r) => !r.duplicate);
      if (!data.commit) return sendJson(res, 200, { rows: prepared, errors, new_count: fresh.length });
      const imported = importLedgerRows(fresh);
      return sendJson(res, 200, { imported, skipped_duplicates: prepared.length - fresh.length, errors });
    }

    if (pathname === '/api/export/ledger.csv' && req.method === 'GET') {
      const csv = ledgerToCsv(listLedger(periodParams(url)));
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="ledger.csv"',
      });
      return res.end(csv);
    }

    if (pathname === '/api/export/orders.csv' && req.method === 'GET') {
      const csv = ordersToCsv(listOrders());
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="orders.csv"',
      });
      return res.end(csv);
    }

    if (pathname === '/api/export/serials.csv' && req.method === 'GET') {
      const csv = serialsToCsv(listSerialBook());
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="serials.csv"',
      });
      return res.end(csv);
    }

    if (pathname.startsWith('/api/')) {
      return sendJson(res, 404, { error: 'Не найдено' });
    }

    return serveStatic(req, res, pathname);
  } catch (err) {
    // Ожидаемые ошибки (занятый номер/серийник и т.п.) — с их кодом и текстом.
    if (err.status >= 400 && err.status < 600) return sendJson(res, err.status, { error: err.message });
    console.error(err);
    return sendJson(res, 500, { error: 'Внутренняя ошибка сервера' });
  }
});

server.listen(PORT, () => {
  console.log(`Order automation site running at http://localhost:${PORT}`);
});
