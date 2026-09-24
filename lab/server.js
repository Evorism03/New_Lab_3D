import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  STATUSES,
  MODELS,
  COLORS,
  CONNECTORS,
  PRODUCTS,
  DELIVERY_SERVICES,
  listOrders,
  getOrder,
  createOrder,
  updateOrder,
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
  patchOrderOzonShipment,
  listUsers,
  findUserById,
  createOrUpdateUser,
  updateUserPassword,
  deleteUser,
  verifyPassword,
  createSession,
  getSessionUser,
  deleteSession,
} from './db.js';
import { buildLabelPdf } from './lib/label.js';
import * as ozon from './lib/ozon.js';

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
    'ID заказа',
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
        o.id,
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

function serialsToCsv(rows) {
  const header = [
    'ID заказа',
    'Клиент',
    'Телефон',
    'Статус',
    'Модель',
    'Товар',
    'Цвет',
    'Разъём',
    'Кол-во',
    'Цена',
    'Серийный номер',
  ];
  const statusLabel = (id) => STATUSES.find((s) => s.id === id)?.label || id;
  const lines = [header.map(csvEscape).join(';')];
  for (const r of rows) {
    lines.push(
      [
        r.order_id,
        r.full_name,
        r.phone,
        statusLabel(r.status),
        modelLabel(r.model_id),
        r.product_name,
        colorLabel(r.color),
        connectorLabel(r.connector),
        r.quantity,
        r.price,
        r.serial_number,
      ]
        .map(csvEscape)
        .join(';')
    );
  }
  return '﻿' + lines.join('\r\n');
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
  if (!id) throw new Error('Сначала настройте метод отгрузки на странице «Ozon Доставка»');
  return Number(id);
}

function ozonDeliveryPointId(order) {
  if (!order.ozon_delivery_point_id) throw new Error('Укажите ID ПВЗ Ozon в блоке «Ozon Доставка» этого заказа');
  return Number(order.ozon_delivery_point_id);
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
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
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
        products: PRODUCTS,
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

    if (pathname === '/api/serials' && req.method === 'GET') {
      return sendJson(res, 200, listSerials());
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
      });
    }

    if (pathname === '/api/ozon/settings' && req.method === 'POST') {
      const data = await readBody(req);
      if (data.client_id != null) setSetting('ozon_client_id', String(data.client_id).trim());
      if (data.client_secret) setSetting('ozon_client_secret', String(data.client_secret).trim());
      if (data.shipment_method_id != null) setSetting('ozon_shipment_method_id', String(data.shipment_method_id).trim());
      return sendJson(res, 200, { ok: true });
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
          delivery: { delivery_point: { delivery_point_id: ozonDeliveryPointId(order) } },
        };
        const result = await ozon.orderCheckout(payload);
        const updated = patchOrderOzonShipment(orderId, {
          checkout: result.results?.[0] || result,
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
          delivery: { delivery_point: { delivery_point_id: ozonDeliveryPointId(order) } },
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

    const ozonLabelMatch = pathname.match(/^\/api\/orders\/(\d+)\/ozon\/label\.pdf$/);
    if (ozonLabelMatch && req.method === 'GET') {
      const orderId = Number(ozonLabelMatch[1]);
      const order = getOrder(orderId);
      if (!order) return sendJson(res, 404, { error: 'Заказ не найден' });
      const postingNumber = order.ozon_shipment?.posting_number;
      if (!postingNumber) return sendJson(res, 400, { error: 'Сначала создайте черновик заказа в Ozon' });
      try {
        const result = await ozon.postingLabel(postingNumber);
        const fileContent = result.file_content || result.fileContent;
        if (!fileContent) return sendJson(res, 502, { error: 'Ozon не вернул содержимое этикетки' });
        const buffer = Buffer.from(fileContent, 'base64');
        patchOrderOzonShipment(orderId, { label_downloaded_at: new Date().toISOString() });
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${postingNumber}.pdf"`,
        });
        return res.end(buffer);
      } catch (err) {
        return sendJson(res, 502, { error: err.message });
      }
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
      const csv = serialsToCsv(listSerials());
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
    console.error(err);
    return sendJson(res, 500, { error: 'Внутренняя ошибка сервера' });
  }
});

server.listen(PORT, () => {
  console.log(`Order automation site running at http://localhost:${PORT}`);
});
