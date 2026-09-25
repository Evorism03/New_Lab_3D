import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'orders.db'));

db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    delivery_service TEXT,
    pvz_address TEXT,
    full_name TEXT,
    phone TEXT,
    delivery_price REAL NOT NULL DEFAULT 0,
    notes TEXT,
    weight_g INTEGER,
    length_mm INTEGER,
    width_mm INTEGER,
    height_mm INTEGER,
    ozon_delivery_point_id TEXT,
    ozon_shipment TEXT
  );

  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    model_id TEXT,
    product_name TEXT,
    color TEXT,
    connector TEXT,
    quantity INTEGER NOT NULL DEFAULT 1,
    price REAL NOT NULL DEFAULT 0,
    serial_number TEXT,
    assembled_at TEXT
  );

  CREATE TABLE IF NOT EXISTS receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    uploaded_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'employee',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
`);

// Columns added after the first release; add them for databases created before that.
for (const stmt of [
  'ALTER TABLE items ADD COLUMN model_id TEXT',
  'ALTER TABLE items ADD COLUMN assembled_at TEXT',
  'ALTER TABLE orders ADD COLUMN weight_g INTEGER',
  'ALTER TABLE orders ADD COLUMN length_mm INTEGER',
  'ALTER TABLE orders ADD COLUMN width_mm INTEGER',
  'ALTER TABLE orders ADD COLUMN height_mm INTEGER',
  'ALTER TABLE orders ADD COLUMN ozon_delivery_point_id TEXT',
  'ALTER TABLE orders ADD COLUMN ozon_shipment TEXT',
  // Ручной порядок карточек в колонке доски (NULL — ещё не двигали, такие идут сверху).
  'ALTER TABLE orders ADD COLUMN board_position INTEGER',
  // СДЭК: код ПВЗ получателя и JSON с данными заказа в СДЭК (uuid, номер, статусы, расчёт).
  'ALTER TABLE orders ADD COLUMN cdek_pvz_code TEXT',
  // Номер заказа для людей (редактируемый). Пусто — показывается внутренний ID.
  'ALTER TABLE orders ADD COLUMN number TEXT',
  // Чек «Мой налог» по заказу: JSON { uuid, url, total, lines, created_at, canceled_at, cancel_reason }.
  'ALTER TABLE orders ADD COLUMN npd_receipt TEXT',
  'ALTER TABLE orders ADD COLUMN cdek_shipment TEXT',
  // Заказы 3D-печати из New_Lab_3d (приходят через /api/external/orders).
  "ALTER TABLE orders ADD COLUMN source TEXT DEFAULT 'manual'",
  'ALTER TABLE orders ADD COLUMN external_order_id TEXT',
  "ALTER TABLE orders ADD COLUMN payment_status TEXT DEFAULT 'unpaid'",
  'ALTER TABLE orders ADD COLUMN customer_email TEXT',
  'ALTER TABLE orders ADD COLUMN shipping_address TEXT',
  "ALTER TABLE items ADD COLUMN item_kind TEXT DEFAULT 'hardware'",
  'ALTER TABLE items ADD COLUMN material TEXT',
  'ALTER TABLE items ADD COLUMN finish TEXT',
  'ALTER TABLE items ADD COLUMN source_file TEXT',
  'ALTER TABLE items ADD COLUMN external_ref TEXT',
  'ALTER TABLE items ADD COLUMN source_file_url TEXT',
]) {
  try {
    db.exec(stmt);
  } catch {
    // column already exists
  }
}

// Один внешний заказ (по id из New_Lab_3d) не должен задваиваться при повторном пуше.
// NULL допускает сколько угодно "обычных" заказов без external_order_id.
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_external_order_id ON orders(external_order_id)');

// Общее key/value хранилище настроек (токены/ID внешних интеграций и т.п.) — не в git, в data/orders.db.
export function getSetting(key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? '';
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?').run(
    key,
    value,
    value
  );
}

export const STATUSES = [
  { id: 'new', label: 'Новый заказ' },
  { id: 'to_collect', label: 'Собрать' },
  { id: 'collected', label: 'Собран' },
  { id: 'shipped', label: 'Отправлен' },
  { id: 'delivered', label: 'Доставлен' },
  { id: 'cancelled', label: 'Отменён' },
];

// Расшифровка серийника: [Код модели][R + ревизия, 2 цифры][Цвет][Разъём][Счётчик, 4 цифры]
// Пример: AL1 + R03 + T + T + 0043 = AL1R03TT0043
// Модели/цвета/разъёмы меняются редко — правится здесь вручную по запросу.
export const MODELS = [
  { id: 'al-1', label: 'AL-1', code: 'AL1', revision: 3 },
];

// swatch — цвет кружка-метки в интерфейсе (максимально похожий на реальный цвет товара)
export const COLORS = [
  { letter: 'O', label: 'Олива (Olive)', shortLabel: 'Олива', swatch: '#6b8e23' },
  { letter: 'T', label: 'Прозрачный (Transparent)', shortLabel: 'Прозрачный', swatch: '#d9e2ec' },
  { letter: 'B', label: 'Черный (Black)', shortLabel: 'Черный', swatch: '#1a1a1a' },
  { letter: 'D', label: 'Песочный (Desert)', shortLabel: 'Песочный', swatch: '#c2a878' },
  { letter: 'P', label: 'Розовый (Pink)', shortLabel: 'Розовый', swatch: '#ec4899' },
];

// plugLabel — как разъём подписывается на этикетке (см. пример макета).
// swatch — у разъёмов нет реального цвета, метка просто для быстрого визуального различия.
export const CONNECTORS = [
  { letter: 'T', label: 'Т-образный', plugLabel: 'T-Plug', swatch: '#38bdf8' },
  { letter: 'M', label: 'Mini Tamiya', plugLabel: 'Mini Tamiya', swatch: '#a78bfa' },
];

// Каталог товаров для выпадающего списка "Товар" — меняется редко, правится здесь.
export const PRODUCTS = [
  { id: 'auto-loader', label: 'Автоматический лоадер' },
];

// Каталог транспортных компаний — тоже со своей меткой-кружком для быстрого сканирования глазами.
export const DELIVERY_SERVICES = [
  { id: 'sdek', label: 'СДЭК', swatch: '#22c55e' },
  { id: 'ozon', label: 'Озон', swatch: '#3b82f6' },
  { id: 'pochta', label: 'Почта России', swatch: '#f97316' },
  { id: 'other', label: 'Другое', swatch: '#6b7280' },
];

export function colorLabel(letter) {
  return COLORS.find((c) => c.letter === letter)?.label || letter || '';
}

export function colorShortLabel(letter) {
  return COLORS.find((c) => c.letter === letter)?.shortLabel || letter || '';
}

export function connectorLabel(letter) {
  return CONNECTORS.find((c) => c.letter === letter)?.label || letter || '';
}

export function connectorPlugLabel(letter) {
  return CONNECTORS.find((c) => c.letter === letter)?.plugLabel || letter || '';
}

export function modelLabel(id) {
  return MODELS.find((m) => m.id === id)?.label || id || '';
}

export function modelRevisionLabel(model) {
  return `${model.label} Рев. ${model.revision}`;
}

function modelPrefix(model) {
  return `${model.code}R${String(model.revision).padStart(2, '0')}`;
}

// Из "AL1R03TT0043" достаёт номер 43, если серийник от этой модели и правильного формата.
function parseSerialNumber(model, serial) {
  const prefix = modelPrefix(model);
  if (!serial || !serial.startsWith(prefix)) return null;
  const rest = serial.slice(prefix.length);
  if (!/^[A-Z][A-Z]\d{4}$/.test(rest)) return null;
  return Number(rest.slice(2));
}

// Номер занят, если он уже сохранён в каком-то заказе — с любыми буквами цвета/разъёма.
function isNumberOccupied(model, number) {
  const pattern = `${modelPrefix(model)}__${String(number).padStart(4, '0')}`;
  return !!db.prepare('SELECT 1 FROM items WHERE model_id = ? AND serial_number LIKE ? LIMIT 1').get(model.id, pattern);
}

// Наименьший ещё не занятый номер для модели. Никакого отдельного счётчика нет
// специально: если заказ с номером 0001 удалили, этот номер снова свободен и
// его же выдаст следующая генерация — не будет вечно пропущен.
function firstFreeNumber(model) {
  let n = 1;
  while (isNumberOccupied(model, n)) n++;
  return n;
}

// Если currentSerial ещё не занят ни одним сохранённым товаром, номер остаётся тем же
// и меняются только буквы цвета/разъёма. Иначе выдаётся наименьший свободный номер.
export function generateSerial(modelId, colorLetter, connectorLetter, currentSerial) {
  const model = MODELS.find((m) => m.id === modelId);
  if (!model) throw new Error('Неизвестная модель');
  if (!COLORS.some((c) => c.letter === colorLetter)) throw new Error('Неизвестный цвет');
  if (!CONNECTORS.some((c) => c.letter === connectorLetter)) throw new Error('Неизвестный разъём');

  const existingNumber = currentSerial ? parseSerialNumber(model, currentSerial) : null;
  const number =
    existingNumber != null && !isNumberOccupied(model, existingNumber) ? existingNumber : firstFreeNumber(model);

  return `${modelPrefix(model)}${colorLetter}${connectorLetter}${String(number).padStart(4, '0')}`;
}

function itemsForOrder(orderId) {
  return db.prepare('SELECT * FROM items WHERE order_id = ? ORDER BY id').all(orderId);
}

function parseOzonShipment(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function withTotals(order) {
  const items = itemsForOrder(order.id);
  const goodsTotal = items.reduce((sum, it) => sum + it.price * it.quantity, 0);
  const receiptsCount = db.prepare('SELECT COUNT(*) as c FROM receipts WHERE order_id = ?').get(order.id).c;
  return {
    ...order,
    items,
    goods_total: goodsTotal,
    grand_total: goodsTotal + order.delivery_price,
    receipts_count: receiptsCount,
    display_number: order.number || String(order.id),
    ozon_shipment: parseOzonShipment(order.ozon_shipment),
    cdek_shipment: parseOzonShipment(order.cdek_shipment),
    npd_receipt: parseOzonShipment(order.npd_receipt),
  };
}

export function listOrders({ status, q } = {}) {
  let rows = db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
  if (status) rows = rows.filter((o) => o.status === status);
  let orders = rows.map(withTotals);
  if (q) {
    const needle = q.toLowerCase();
    orders = orders.filter((o) => {
      const haystack = [
        `#${o.display_number}`,
        o.full_name,
        o.phone,
        o.pvz_address,
        o.delivery_service,
        o.notes,
        ...o.items.map(
          (it) =>
            `${it.product_name} ${it.serial_number} ${colorLabel(it.color)} ${connectorLabel(it.connector)}`
        ),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }
  return orders;
}

export function getOrder(id) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) return null;
  return { ...withTotals(order), receipts: listReceipts(id) };
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Номер заказа: до 30 символов; уникален среди номеров и ID других заказов (то, что видно как «#…»).
function cleanOrderNumber(value, excludeId) {
  const number = String(value ?? '').trim().replace(/^#/, '');
  if (!number) return null;
  if (number.length > 30) throw httpError(400, 'Номер заказа — не длиннее 30 символов');
  const clash = db
    .prepare(
      `SELECT id FROM orders WHERE id != ? AND LOWER(COALESCE(NULLIF(number, ''), CAST(id AS TEXT))) = LOWER(?)`
    )
    .get(excludeId ?? -1, number);
  if (clash) throw httpError(409, `Номер «${number}» уже занят другим заказом`);
  return number;
}

// Серийник должен быть уникален: не повторяться внутри заказа и не совпадать с товаром другого заказа.
export function findSerialOwner(serial, { excludeOrderId = null, excludeItemId = null } = {}) {
  const value = String(serial || '').trim();
  if (!value) return null;
  return db
    .prepare(
      `SELECT items.id AS item_id, orders.id AS order_id, COALESCE(NULLIF(orders.number, ''), CAST(orders.id AS TEXT)) AS order_number
       FROM items JOIN orders ON orders.id = items.order_id
       WHERE UPPER(TRIM(items.serial_number)) = UPPER(?) AND orders.id != ? AND items.id != ?
       LIMIT 1`
    )
    .get(value, excludeOrderId ?? -1, excludeItemId ?? -1) || null;
}

function assertSerialsFree(items, orderId) {
  const seen = new Set();
  for (const it of items || []) {
    const serial = String(it.serial_number || '').trim().toUpperCase();
    if (!serial) continue;
    if (seen.has(serial)) throw httpError(409, `Серийный номер ${serial} указан в заказе дважды`);
    seen.add(serial);
    const owner = findSerialOwner(serial, { excludeOrderId: orderId });
    if (owner) throw httpError(409, `Серийный номер ${serial} уже занят в заказе #${owner.order_number}`);
  }
}

export function createOrder(data) {
  const now = new Date().toISOString();
  const number = cleanOrderNumber(data.number, null);
  assertSerialsFree(data.items, null);
  const info = db
    .prepare(
      `INSERT INTO orders (created_at, updated_at, status, delivery_service, pvz_address, full_name, phone, delivery_price, notes,
         source, external_order_id, payment_status, customer_email, shipping_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      now,
      now,
      data.status || 'new',
      data.delivery_service || '',
      data.pvz_address || '',
      data.full_name || '',
      data.phone || '',
      Number(data.delivery_price) || 0,
      data.notes || '',
      data.source || 'manual',
      data.external_order_id || null,
      data.payment_status || 'unpaid',
      data.customer_email || '',
      data.shipping_address || ''
    );
  const orderId = info.lastInsertRowid;
  if (number) db.prepare('UPDATE orders SET number = ? WHERE id = ?').run(number, orderId);
  insertItems(orderId, data.items || []);
  return getOrder(orderId);
}

function insertItems(orderId, items) {
  const stmt = db.prepare(
    `INSERT INTO items (order_id, model_id, product_name, color, connector, quantity, price, serial_number, assembled_at,
       item_kind, material, finish, source_file, external_ref, source_file_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const it of items) {
    stmt.run(
      orderId,
      it.model_id || '',
      it.product_name || '',
      it.color || '',
      it.connector || '',
      Number(it.quantity) || 1,
      Number(it.price) || 0,
      it.serial_number || '',
      it.assembled_at || '',
      it.item_kind || 'hardware',
      it.material || '',
      it.finish || '',
      it.source_file || '',
      it.external_ref || '',
      it.source_file_url || ''
    );
  }
}

export function updateOrder(id, data) {
  const existing = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  if (data.number !== undefined) {
    db.prepare('UPDATE orders SET number = ? WHERE id = ?').run(cleanOrderNumber(data.number, id), id);
  }
  if (data.items) assertSerialsFree(data.items, id);
  db.prepare(
    `UPDATE orders SET updated_at = ?, status = ?, delivery_service = ?, pvz_address = ?,
       full_name = ?, phone = ?, delivery_price = ?, notes = ? WHERE id = ?`
  ).run(
    now,
    data.status ?? existing.status,
    data.delivery_service ?? existing.delivery_service,
    data.pvz_address ?? existing.pvz_address,
    data.full_name ?? existing.full_name,
    data.phone ?? existing.phone,
    data.delivery_price != null ? Number(data.delivery_price) : existing.delivery_price,
    data.notes ?? existing.notes,
    id
  );
  // Заказ ушёл в другую колонку — встаёт наверх новой колонки, пока его не передвинут вручную.
  if (data.status && data.status !== existing.status) {
    db.prepare('UPDATE orders SET board_position = NULL WHERE id = ?').run(id);
  }
  if (data.items) {
    db.prepare('DELETE FROM items WHERE order_id = ?').run(id);
    insertItems(id, data.items);
  }
  return getOrder(id);
}

// Перетаскивание на доске: заказ встаёт в колонку status, порядок колонки — как в ids.
export function reorderBoardColumn(status, ids) {
  const now = new Date().toISOString();
  const setStatus = db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status != ?');
  const setPos = db.prepare('UPDATE orders SET board_position = ? WHERE id = ?');
  db.exec('BEGIN');
  try {
    ids.forEach((id, index) => {
      setStatus.run(status, now, id, status);
      setPos.run(index, id);
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function deleteOrder(id) {
  db.prepare('DELETE FROM orders WHERE id = ?').run(id);
}

export function findOrderByExternalId(externalOrderId) {
  return db.prepare('SELECT * FROM orders WHERE external_order_id = ?').get(externalOrderId);
}

// Заказ 3D-печати из New_Lab_3d: вставляет новый или обновляет существующий (по external_order_id),
// чтобы повторный пуш того же заказа (ретрай на сети и т.п.) не плодил дубликаты.
export function createOrUpdateExternalOrder(data) {
  const existing = data.external_order_id ? findOrderByExternalId(data.external_order_id) : null;
  if (!existing) {
    return createOrder({ ...data, source: 'new_lab_3d' });
  }

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE orders SET updated_at = ?, full_name = ?, phone = ?, notes = ?,
       customer_email = ?, shipping_address = ?, delivery_price = ? WHERE id = ?`
  ).run(
    now,
    data.full_name ?? existing.full_name,
    data.phone ?? existing.phone,
    data.notes ?? existing.notes,
    data.customer_email ?? existing.customer_email,
    data.shipping_address ?? existing.shipping_address,
    data.delivery_price != null ? Number(data.delivery_price) : existing.delivery_price,
    existing.id
  );
  if (data.items) {
    db.prepare('DELETE FROM items WHERE order_id = ?').run(existing.id);
    insertItems(existing.id, data.items);
  }
  return getOrder(existing.id);
}

export function markExternalOrderPaid(externalOrderId) {
  const existing = findOrderByExternalId(externalOrderId);
  if (!existing) return null;
  const now = new Date().toISOString();
  db.prepare("UPDATE orders SET payment_status = 'paid', updated_at = ? WHERE id = ?").run(now, existing.id);
  return getOrder(existing.id);
}

export function addReceipt(orderId, { fileName, originalName, mimeType }) {
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO receipts (order_id, file_name, original_name, mime_type, uploaded_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(orderId, fileName, originalName, mimeType, now);
  return db.prepare('SELECT * FROM receipts WHERE id = ?').get(info.lastInsertRowid);
}

export function listReceipts(orderId) {
  return db.prepare('SELECT * FROM receipts WHERE order_id = ? ORDER BY id').all(orderId);
}

export function getReceipt(id) {
  return db.prepare('SELECT * FROM receipts WHERE id = ?').get(id);
}

export function deleteReceipt(id) {
  const receipt = getReceipt(id);
  if (!receipt) return null;
  db.prepare('DELETE FROM receipts WHERE id = ?').run(id);
  return receipt;
}

export function getItem(itemId) {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
  if (!item) return null;
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(item.order_id);
  return { item, order };
}

// Ставит дату сборки, только если она ещё пуста — используется при скачивании
// этикетки (дата фиксируется в момент первой печати) и не трогает уже заданную дату.
export function ensureAssembledAt(itemId, isoDate) {
  const item = db.prepare('SELECT assembled_at FROM items WHERE id = ?').get(itemId);
  if (!item) return null;
  if (item.assembled_at) return item.assembled_at;
  db.prepare('UPDATE items SET assembled_at = ? WHERE id = ?').run(isoDate, itemId);
  return isoDate;
}

export function setItemAssembledAt(itemId, isoDate) {
  const info = db.prepare('UPDATE items SET assembled_at = ? WHERE id = ?').run(isoDate || '', itemId);
  return info.changes > 0;
}

// Габариты посылки и точка выдачи Ozon — редактируются на странице заказа перед отправкой в Ozon Delivery API.
export function setOrderOzonParams(id, { weight_g, length_mm, width_mm, height_mm, ozon_delivery_point_id }) {
  const existing = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!existing) return null;
  db.prepare(
    `UPDATE orders SET weight_g = ?, length_mm = ?, width_mm = ?, height_mm = ?, ozon_delivery_point_id = ? WHERE id = ?`
  ).run(
    weight_g != null && weight_g !== '' ? Math.round(Number(weight_g)) : null,
    length_mm != null && length_mm !== '' ? Math.round(Number(length_mm)) : null,
    width_mm != null && width_mm !== '' ? Math.round(Number(width_mm)) : null,
    height_mm != null && height_mm !== '' ? Math.round(Number(height_mm)) : null,
    ozon_delivery_point_id || '',
    id
  );
  return getOrder(id);
}

export function setOrderOzonDeliveryPoint(id, deliveryPointId) {
  db.prepare('UPDATE orders SET ozon_delivery_point_id = ? WHERE id = ?').run(String(deliveryPointId || ''), id);
  return getOrder(id);
}

// СДЭК: ПВЗ получателя (код + описание в cdek_shipment.point) и данные заказа в СДЭК.
export function patchOrderCdekShipment(id, patch) {
  const existing = db.prepare('SELECT cdek_shipment FROM orders WHERE id = ?').get(id);
  if (!existing) return null;
  const current = parseOzonShipment(existing.cdek_shipment) || {};
  db.prepare('UPDATE orders SET cdek_shipment = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify({ ...current, ...patch }),
    new Date().toISOString(),
    id
  );
  return getOrder(id);
}

export function setOrderNpdReceipt(id, receipt) {
  db.prepare('UPDATE orders SET npd_receipt = ?, updated_at = ? WHERE id = ?').run(
    receipt ? JSON.stringify(receipt) : null,
    new Date().toISOString(),
    id
  );
  return getOrder(id);
}

export function setOrderCdekPoint(id, point) {
  db.prepare('UPDATE orders SET cdek_pvz_code = ? WHERE id = ?').run(point?.code ? String(point.code) : '', id);
  return patchOrderCdekShipment(id, { point: point?.code ? point : null });
}

// Черновик/статус отправления Ozon Delivery хранится как JSON в orders.ozon_shipment —
// отдельной схемы под каждый метод не заводим, копим туда всё, что вернул API по заказу.
export function setOrderOzonShipment(id, data) {
  const now = new Date().toISOString();
  db.prepare('UPDATE orders SET ozon_shipment = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(data || null),
    now,
    id
  );
  return getOrder(id);
}

export function patchOrderOzonShipment(id, patch) {
  const existing = db.prepare('SELECT ozon_shipment FROM orders WHERE id = ?').get(id);
  if (!existing) return null;
  const current = parseOzonShipment(existing.ozon_shipment) || {};
  return setOrderOzonShipment(id, { ...current, ...patch });
}

export function listSerials() {
  const rows = db
    .prepare(
      `SELECT items.id as item_id, items.model_id, items.product_name, items.color, items.connector,
              items.quantity, items.price, items.serial_number, items.assembled_at,
              orders.id as order_id, COALESCE(NULLIF(orders.number, ''), CAST(orders.id AS TEXT)) as order_number,
              orders.full_name, orders.phone, orders.status,
              orders.delivery_service, orders.pvz_address, orders.created_at
       FROM items JOIN orders ON orders.id = items.order_id
       ORDER BY orders.id DESC, items.id`
    )
    .all();
  return rows;
}

// --- Пользователи и сессии --------------------------------------------------
// Логин сотрудников: пароли хранятся только как bcrypt-хеш, сессия — случайный
// токен в отдельной таблице (не JWT — проще отозвать/увидеть активные сессии позже).

const SESSION_TTL_DAYS = 30;

export function listUsers() {
  return db.prepare('SELECT id, username, role, created_at FROM users ORDER BY id').all();
}

export function findUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

export function findUserById(id) {
  return db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?').get(id);
}

export function countUsers() {
  return db.prepare('SELECT COUNT(*) as c FROM users').get().c;
}

// upsert по username — тем же приёмом, что seed-скрипт админа в New_Lab_3d:
// безопасно перезапускать (setup можно повторить, чтобы сбросить пароль админа).
export function createOrUpdateUser({ username, password, role }) {
  const passwordHash = bcrypt.hashSync(password, 10);
  const now = new Date().toISOString();
  const existing = findUserByUsername(username);
  if (existing) {
    db.prepare('UPDATE users SET password_hash = ?, role = ? WHERE id = ?').run(passwordHash, role || existing.role, existing.id);
    return findUserById(existing.id);
  }
  const info = db
    .prepare('INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)')
    .run(username, passwordHash, role || 'employee', now);
  return findUserById(info.lastInsertRowid);
}

export function updateUserPassword(id, password) {
  const passwordHash = bcrypt.hashSync(password, 10);
  const info = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
  return info.changes > 0;
}

export function deleteUser(id) {
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

export function verifyPassword(username, password) {
  const user = findUserByUsername(username);
  if (!user) return null;
  if (!bcrypt.compareSync(password, user.password_hash)) return null;
  return user;
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    token,
    userId,
    now.toISOString(),
    expires.toISOString()
  );
  return { token, expiresAt: expires };
}

export function getSessionUser(token) {
  if (!token) return null;
  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return findUserById(session.user_id);
}

export function deleteSession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export default db;
