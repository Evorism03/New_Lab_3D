import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import './public/address.js'; // globalThis.LabAddress — город из адреса ПВЗ для описания продажи в бухгалтерии

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

  -- Бухгалтерия: журнал операций (как лист «Бухгалтерия» в таблице). Одна строка может
  -- содержать и поступление, и списание: продажа = оплата покупателя + расход на доставку.
  CREATE TABLE IF NOT EXISTS ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    income REAL NOT NULL DEFAULT 0,
    expense REAL NOT NULL DEFAULT 0,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    warranty INTEGER NOT NULL DEFAULT 0,
    taxable INTEGER NOT NULL DEFAULT 0,
    delivery_account INTEGER NOT NULL DEFAULT 0,
    order_id INTEGER UNIQUE REFERENCES orders(id) ON DELETE SET NULL,
    locked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ledger_date ON ledger(date);

  -- Пополнения счёта доставки (Ozon/СДЭК списывают доставку с предоплаченного счёта).
  CREATE TABLE IF NOT EXISTS delivery_topups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
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
  // Только для заказов с сайта (есть файл модели, который нужно напечатать) — см. assertPrintAllowed.
  { id: 'printing', label: 'Печать' },
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
    // Тег происхождения: заказы из New_Lab_3d — «Сайт», всё созданное в самой CRM — «CRM».
    source_tag: order.source === SITE_SOURCE ? 'site' : 'crm',
    source_label: order.source === SITE_SOURCE ? 'Сайт' : 'CRM',
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
  syncOrderLedger(orderId);
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

export const SITE_SOURCE = 'new_lab_3d';

// «Печать» — только для заказов с сайта: у них есть файл, который нужно напечатать.
function assertPrintAllowed(status, orderIds) {
  if (status !== 'printing') return;
  for (const oid of orderIds) {
    const row = db.prepare('SELECT source FROM orders WHERE id = ?').get(oid);
    if (row && row.source !== SITE_SOURCE) {
      throw Object.assign(new Error('В «Печать» можно переносить только заказы с сайта'), { status: 400 });
    }
  }
}

export function updateOrder(id, data) {
  const existing = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!existing) return null;
  if (data.status && data.status !== existing.status) assertPrintAllowed(data.status, [id]);
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
  syncOrderLedger(id);
  return getOrder(id);
}

// Перетаскивание на доске: заказ встаёт в колонку status, порядок колонки — как в ids.
export function reorderBoardColumn(status, ids) {
  assertPrintAllowed(status, ids);
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
  // Отмена заказа убирает его продажу из бухгалтерии (и возвращает при переносе обратно).
  ids.forEach((id) => syncOrderLedger(id));
}

export function deleteOrder(id) {
  // Автозапись продажи удаляется вместе с заказом; исправленная вручную — остаётся (order_id станет NULL).
  db.prepare('DELETE FROM ledger WHERE order_id = ? AND locked = 0').run(id);
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
  syncOrderLedger(existing.id);
  return getOrder(existing.id);
}

export function markExternalOrderPaid(externalOrderId) {
  const existing = findOrderByExternalId(externalOrderId);
  if (!existing) return null;
  const now = new Date().toISOString();
  db.prepare("UPDATE orders SET payment_status = 'paid', updated_at = ? WHERE id = ?").run(now, existing.id);
  syncOrderLedger(existing.id);
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

// --- Бухгалтерия ------------------------------------------------------------
// Журнал поступлений/списаний вместо листа «Бухгалтерия» в Google-таблице. Продажи из заказов
// попадают сюда сами (syncOrderLedger), остальное — расходы на материалы, логистику ремонта
// и т.п. — вносится вручную на странице /accounting.html.

// Подсказки для поля «Категория» (можно вписать и свою).
export const LEDGER_CATEGORIES = [
  'Продажа',
  '3D-печать',
  'Материалы',
  'Комплектующие',
  'Расходники',
  'Оборудование',
  'Логистика',
  'Возврат',
  'Реклама',
  'Питание',
  'Налоги',
  'Комиссии',
  'Офис',
  'Прочее',
];

const SALE_CATEGORY = 'Продажа';

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Дата в часовом поясе сервера (заказы хранят created_at в UTC).
export function localDate(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addDays(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + days));
}

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function readJsonSetting(key, fallback) {
  try {
    const value = JSON.parse(getSetting(key) || 'null');
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

// Автозаполнение берёт заказы начиная с этой даты: всё, что раньше, уже внесено в таблицу руками
// (и переносится импортом), иначе продажи задвоятся. При первом запуске — сегодняшний день.
if (!getSetting('acc_auto_since')) setSetting('acc_auto_since', localDate());

export function getAccountingSettings() {
  return {
    tax_rate: Number(getSetting('acc_tax_rate') || 4),
    warranty_days: Number(getSetting('acc_warranty_days') || 92),
    auto_since: getSetting('acc_auto_since'),
    bank_name: getSetting('acc_bank_name') || 'Банк',
    bank_balance: getSetting('acc_bank_balance') === '' ? null : Number(getSetting('acc_bank_balance')),
    bank_date: getSetting('acc_bank_date'),
    fixed_costs: readJsonSetting('acc_fixed_costs', []),
    // Заказы, продажу которых удалили из журнала вручную (можно вернуть на странице бухгалтерии).
    excluded_orders: [...excludedOrders()]
      .map((id) => db.prepare(`SELECT id, COALESCE(NULLIF(number, ''), CAST(id AS TEXT)) AS number FROM orders WHERE id = ?`).get(id))
      .filter(Boolean),
  };
}

export function setAccountingSettings(data) {
  if (data.tax_rate != null) {
    const rate = Number(String(data.tax_rate).replace(',', '.'));
    if (!(rate >= 0 && rate <= 100)) throw httpError(400, 'Ставка налога — от 0 до 100 %');
    setSetting('acc_tax_rate', String(rate));
  }
  if (data.warranty_days != null) {
    const days = Math.round(Number(data.warranty_days));
    if (!(days >= 0 && days <= 3650)) throw httpError(400, 'Срок гарантии — от 0 до 3650 дней');
    setSetting('acc_warranty_days', String(days));
  }
  if (data.auto_since != null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.auto_since)) throw httpError(400, 'Неверная дата начала автозаполнения');
    setSetting('acc_auto_since', data.auto_since);
  }
  if (data.bank_name != null) setSetting('acc_bank_name', String(data.bank_name).trim().slice(0, 60));
  if (data.bank_balance !== undefined) {
    const empty = data.bank_balance === null || data.bank_balance === '';
    setSetting('acc_bank_balance', empty ? '' : String(roundMoney(data.bank_balance)));
    setSetting('acc_bank_date', empty ? '' : localDate());
  }
  if (data.fixed_costs != null) {
    const list = (Array.isArray(data.fixed_costs) ? data.fixed_costs : [])
      .map((c) => ({ name: String(c?.name || '').trim().slice(0, 80), amount: roundMoney(c?.amount) }))
      .filter((c) => c.name);
    setSetting('acc_fixed_costs', JSON.stringify(list));
  }
  return getAccountingSettings();
}

// Заказы, запись о продаже которых удалили вручную, — синхронизация их больше не создаёт.
function excludedOrders() {
  const list = readJsonSetting('acc_excluded_orders', []);
  return new Set(Array.isArray(list) ? list.map(Number) : []);
}

function setOrderExcluded(orderId, excluded) {
  const set = excludedOrders();
  if (excluded) set.add(Number(orderId));
  else set.delete(Number(orderId));
  setSetting('acc_excluded_orders', JSON.stringify([...set]));
}

// «Продажа AL-1 ×2 · СДЭК · Москва» — как строки продаж в таблице.
function saleDescription(order) {
  const totals = new Map();
  for (const it of order.items) {
    const name = modelLabel(it.model_id) || it.product_name || 'Товар';
    totals.set(name, (totals.get(name) || 0) + (Number(it.quantity) || 0));
  }
  const goods = [...totals.entries()].map(([name, qty]) => (qty > 1 ? `${name} ×${qty}` : name)).join(', ');
  let city = '';
  try {
    const { parseAddress, cityNames } = globalThis.LabAddress;
    city = cityNames(parseAddress(order.pvz_address || order.shipping_address || ''))[0] || '';
  } catch {
    // адрес не разобрался — без города
  }
  return [`Продажа ${goods || 'товаров'}`, order.delivery_service, city].filter(Boolean).join(' · ');
}

// Что должно лежать в журнале по заказу (или null — ничего). Заказы из CRM заводятся уже после
// оплаты; заказы с сайта — только когда оплата подтверждена.
function orderSaleEntry(order) {
  if (!order || order.status === 'cancelled') return null;
  if (order.source === SITE_SOURCE && order.payment_status !== 'paid') return null;
  if (!(order.grand_total > 0)) return null;
  const date = localDate(order.created_at);
  if (date < getSetting('acc_auto_since')) return null;
  if (excludedOrders().has(order.id)) return null;
  // Гарантия — на изделия из каталога моделей (AL-1 и т.п.); печать на заказ — без гарантии.
  const warranty = order.items.some((it) => MODELS.some((m) => m.id === it.model_id)) ? 1 : 0;
  const printOnly = order.items.length > 0 && order.items.every((it) => it.item_kind === 'print');
  const expense = roundMoney(order.delivery_price);
  return {
    date,
    income: roundMoney(order.grand_total),
    expense,
    description: saleDescription(order),
    category: printOnly ? '3D-печать' : SALE_CATEGORY,
    warranty,
    taxable: 1,
    delivery_account: expense > 0 ? 1 : 0,
  };
}

export function syncOrderLedger(orderId) {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  const existing = db.prepare('SELECT * FROM ledger WHERE order_id = ?').get(orderId);
  if (existing?.locked) return; // исправлено вручную — не трогаем
  const entry = row ? orderSaleEntry(withTotals(row)) : null;
  if (!entry) {
    if (existing) db.prepare('DELETE FROM ledger WHERE id = ?').run(existing.id);
    return;
  }
  const now = new Date().toISOString();
  if (existing) {
    db.prepare(
      `UPDATE ledger SET date = ?, income = ?, expense = ?, description = ?, category = ?, warranty = ?, taxable = ?,
         delivery_account = ?, updated_at = ? WHERE id = ?`
    ).run(entry.date, entry.income, entry.expense, entry.description, entry.category, entry.warranty, entry.taxable,
      entry.delivery_account, now, existing.id);
  } else {
    db.prepare(
      `INSERT INTO ledger (date, income, expense, description, category, warranty, taxable, delivery_account, order_id,
         locked, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    ).run(entry.date, entry.income, entry.expense, entry.description, entry.category, entry.warranty, entry.taxable,
      entry.delivery_account, orderId, now, now);
  }
}

export function syncAllOrdersLedger() {
  const ids = db.prepare('SELECT id FROM orders').all().map((r) => r.id);
  for (const id of ids) syncOrderLedger(id);
  // Записи с датой раньше начала автозаполнения, если их не правили руками, убираются.
  db.prepare('DELETE FROM ledger WHERE order_id IS NOT NULL AND locked = 0 AND date < ?').run(getSetting('acc_auto_since'));
  return ids.length;
}

function ledgerRow(row, { warrantyDays, today }) {
  const net = roundMoney(row.income - row.expense);
  const warrantyUntil = row.warranty ? addDays(row.date, warrantyDays) : null;
  return {
    ...row,
    warranty: !!row.warranty,
    taxable: !!row.taxable,
    delivery_account: !!row.delivery_account,
    locked: !!row.locked,
    auto: row.order_id != null,
    order_number: row.order_number ?? null,
    net,
    warranty_until: warrantyUntil,
    // Как в таблице: гарантия «замораживает» только заработанное (net > 0), расходы считаются сразу.
    frozen: !!warrantyUntil && net > 0 && warrantyUntil > today,
  };
}

function ledgerRows({ from, to } = {}) {
  const where = [];
  const params = [];
  if (from) { where.push('ledger.date >= ?'); params.push(from); }
  if (to) { where.push('ledger.date <= ?'); params.push(to); }
  const rows = db
    .prepare(
      `SELECT ledger.*, COALESCE(NULLIF(orders.number, ''), CAST(orders.id AS TEXT)) AS order_number
       FROM ledger LEFT JOIN orders ON orders.id = ledger.order_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY ledger.date DESC, ledger.id DESC`
    )
    .all(...params);
  const opts = { warrantyDays: getAccountingSettings().warranty_days, today: localDate() };
  return rows.map((r) => ledgerRow(r, opts));
}

export function listLedger({ from, to, q } = {}) {
  let rows = ledgerRows({ from, to });
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter((r) =>
      [r.description, r.category, r.order_number ? `#${r.order_number}` : '', r.income, r.expense].join(' ').toLowerCase().includes(needle)
    );
  }
  return rows;
}

function getLedgerEntry(id) {
  return ledgerRows().find((r) => r.id === Number(id)) || null;
}

function cleanLedgerInput(data, existing = {}) {
  const pick = (key) => (data[key] !== undefined ? data[key] : existing[key]);
  const date = String(pick('date') || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw httpError(400, 'Укажите дату');
  const income = roundMoney(pick('income'));
  const expense = roundMoney(pick('expense'));
  if (income < 0 || expense < 0) throw httpError(400, 'Суммы не могут быть отрицательными');
  if (!income && !expense) throw httpError(400, 'Укажите сумму поступления или списания');
  const description = String(pick('description') || '').trim().slice(0, 300);
  if (!description) throw httpError(400, 'Укажите назначение');
  return {
    date,
    income,
    expense,
    description,
    category: String(pick('category') || '').trim().slice(0, 60),
    warranty: pick('warranty') ? 1 : 0,
    taxable: pick('taxable') ? 1 : 0,
    delivery_account: pick('delivery_account') ? 1 : 0,
  };
}

export function createLedgerEntry(data) {
  const e = cleanLedgerInput(data);
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO ledger (date, income, expense, description, category, warranty, taxable, delivery_account,
         locked, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .run(e.date, e.income, e.expense, e.description, e.category, e.warranty, e.taxable, e.delivery_account, now, now);
  return getLedgerEntry(info.lastInsertRowid);
}

// Правка автозаписи «замораживает» её (locked): синхронизация с заказом её больше не трогает.
// data.unlock = true — вернуть автозаполнение (запись пересчитается из заказа).
export function updateLedgerEntry(id, data) {
  const existing = db.prepare('SELECT * FROM ledger WHERE id = ?').get(id);
  if (!existing) return null;
  if (data.unlock && existing.order_id != null) {
    db.prepare('UPDATE ledger SET locked = 0 WHERE id = ?').run(id);
    const orderId = existing.order_id;
    syncOrderLedger(orderId);
    return db.prepare('SELECT id FROM ledger WHERE order_id = ?').get(orderId) ? getLedgerEntry(id) : { removed: true };
  }
  const e = cleanLedgerInput(data, existing);
  db.prepare(
    `UPDATE ledger SET date = ?, income = ?, expense = ?, description = ?, category = ?, warranty = ?, taxable = ?,
       delivery_account = ?, locked = ?, updated_at = ? WHERE id = ?`
  ).run(e.date, e.income, e.expense, e.description, e.category, e.warranty, e.taxable, e.delivery_account,
    existing.order_id != null ? 1 : 0, new Date().toISOString(), id);
  return getLedgerEntry(id);
}

export function deleteLedgerEntry(id) {
  const existing = db.prepare('SELECT * FROM ledger WHERE id = ?').get(id);
  if (!existing) return false;
  // Удалили продажу заказа — не создавать её заново при следующем изменении заказа.
  if (existing.order_id != null) setOrderExcluded(existing.order_id, true);
  db.prepare('DELETE FROM ledger WHERE id = ?').run(id);
  return true;
}

// Вернуть в журнал продажу заказа, запись о которой удалили.
export function restoreOrderLedger(orderId) {
  setOrderExcluded(orderId, false);
  syncOrderLedger(orderId);
}

export function listDeliveryTopups() {
  return db.prepare('SELECT * FROM delivery_topups ORDER BY date DESC, id DESC').all();
}

export function createDeliveryTopup(data) {
  const date = String(data.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw httpError(400, 'Укажите дату');
  const amount = roundMoney(data.amount);
  if (!(amount > 0)) throw httpError(400, 'Укажите сумму пополнения');
  const info = db
    .prepare('INSERT INTO delivery_topups (date, amount, note, created_at) VALUES (?, ?, ?, ?)')
    .run(date, amount, String(data.note || '').trim().slice(0, 120), new Date().toISOString());
  return db.prepare('SELECT * FROM delivery_topups WHERE id = ?').get(info.lastInsertRowid);
}

export function deleteDeliveryTopup(id) {
  return db.prepare('DELETE FROM delivery_topups WHERE id = ?').run(id).changes > 0;
}

// Итоги — те же формулы, что в таблице:
//  «Грязные» = поступления − списания;
//  «Чистые» = то же без денег за изделия, у которых ещё не кончилась гарантия;
//  налог = ставка × облагаемые поступления;
//  долг перед доставкой = доставка, списанная со счёта ТК − пополнения этого счёта;
//  разница с банком = фактический остаток − (грязные за всё время + долг перед доставкой).
export function ledgerSummary({ from, to } = {}) {
  const settings = getAccountingSettings();
  const rows = ledgerRows({ from, to });
  const sum = (list, fn) => roundMoney(list.reduce((acc, r) => acc + fn(r), 0));
  const income = sum(rows, (r) => r.income);
  const expense = sum(rows, (r) => r.expense);
  const frozenRows = rows.filter((r) => r.frozen);
  const frozen = sum(frozenRows, (r) => r.net);
  const taxBase = sum(rows.filter((r) => r.taxable), (r) => r.income);

  // Ближайшее освобождение гарантийных денег.
  const unlocks = new Map();
  for (const r of frozenRows) unlocks.set(r.warranty_until, (unlocks.get(r.warranty_until) || 0) + r.net);
  const nextUnlockDate = [...unlocks.keys()].sort()[0] || null;

  const categories = new Map();
  for (const r of rows) {
    const key = r.category || 'Без категории';
    const c = categories.get(key) || { category: key, income: 0, expense: 0, count: 0 };
    c.income += r.income;
    c.expense += r.expense;
    c.count += 1;
    categories.set(key, c);
  }

  // Долг перед доставкой и сверка с банком — всегда за всё время.
  const all = from || to ? ledgerRows() : rows;
  const deliverySpent = sum(all.filter((r) => r.delivery_account), (r) => r.expense);
  const topups = roundMoney(db.prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM delivery_topups').get().s);
  const deliveryDebt = roundMoney(deliverySpent - topups);
  const dirtyAll = sum(all, (r) => r.net);
  const fixedCosts = sum(settings.fixed_costs, (c) => c.amount);

  return {
    period: { from: from || null, to: to || null },
    count: rows.length,
    income,
    expense,
    dirty: roundMoney(income - expense),
    clean: roundMoney(income - expense - frozen),
    frozen,
    next_unlock: nextUnlockDate ? { date: nextUnlockDate, amount: roundMoney(unlocks.get(nextUnlockDate)) } : null,
    tax_rate: settings.tax_rate,
    tax_base: taxBase,
    tax: roundMoney((taxBase * settings.tax_rate) / 100),
    categories: [...categories.values()]
      .map((c) => ({ ...c, income: roundMoney(c.income), expense: roundMoney(c.expense) }))
      .sort((a, b) => b.income + b.expense - (a.income + a.expense)),
    delivery: { spent: deliverySpent, topups, debt: deliveryDebt },
    fixed_costs: fixedCosts,
    bank: settings.bank_balance == null
      ? null
      : {
          name: settings.bank_name,
          balance: settings.bank_balance,
          date: settings.bank_date,
          expected: roundMoney(dirtyAll + deliveryDebt),
          diff: roundMoney(settings.bank_balance - (dirtyAll + deliveryDebt)),
        },
  };
}

// Категория для строки из старой таблицы — по ключевым словам назначения.
const CATEGORY_RULES = [
  [/возврат/i, 'Возврат'],
  [/продаж/i, SALE_CATEGORY],
  [/печат/i, '3D-печать'],
  [/налог/i, 'Налоги'],
  [/комисси/i, 'Комиссии'],
  [/логистик|доставк|отправк/i, 'Логистика'],
  [/реклам|пост\b/i, 'Реклама'],
  [/питани/i, 'Питание'],
  [/пластик|смол[аы]|филамент/i, 'Материалы'],
  [/принтер|хотен[дт]|стеллаж|гравер|sd карт|флешк|гастро/i, 'Оборудование'],
  [/упаковк|скотч|расходник|спирт|перчатк/i, 'Расходники'],
  [/мотор|кнопк|разъ[её]м|провод|винт|втулк|коннектор|конектор|пружин|микрос|ардуино|датчик|реле|метиз|механ|труб/i, 'Комплектующие'],
];

export function guessLedgerCategory(description, income) {
  for (const [re, category] of CATEGORY_RULES) {
    if (re.test(description)) {
      if ((category === SALE_CATEGORY || category === '3D-печать') && !(income > 0)) continue;
      return category;
    }
  }
  return 'Прочее';
}

// Импорт строк старой таблицы. rows — уже разобранные { date, income, expense, description, warranty }.
// Как в формулах таблицы: доставка со счёта ТК и налог — у продаж с гарантией.
export function importLedgerRows(rows) {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO ledger (date, income, expense, description, category, warranty, taxable, delivery_account,
       locked, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  );
  let count = 0;
  db.exec('BEGIN');
  try {
    for (const r of rows) {
      const e = cleanLedgerInput({
        ...r,
        category: r.category || guessLedgerCategory(r.description, r.income),
        taxable: r.taxable ?? (r.warranty && r.income > 0),
        delivery_account: r.delivery_account ?? (r.warranty && r.income > 0 && r.expense > 0),
      });
      stmt.run(e.date, e.income, e.expense, e.description, e.category, e.warranty, e.taxable, e.delivery_account, now, now);
      count++;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return count;
}

export default db;
