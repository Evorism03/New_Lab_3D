// Статистика для страницы «Статистика» (/stats.html): поток заказов, скорость отправки,
// что сейчас нужно произвести, спрос по товарам/цветам/разъёмам и прогноз на ближайшие недели.
// Считается на лету из заказов — отдельных таблиц нет, кроме истории статусов (order_status_log).
import db, { listOrders, STATUSES, PRE_WORK_STATUSES, COLORS, CONNECTORS, DELIVERY_SERVICES, localDate, colorShortLabel, connectorLabel } from '../db.js';

const DAY = 864e5;
const HOUR = 3600e3;
// «В работе» — ещё не отправлен; «к производству» — ещё не собран (что реально предстоит сделать).
// Заказы в «Новый заказ» и «Согласовывается» в статистику не входят вовсе: они ещё не в работе.
// Заказ попадает в статистику с момента, когда ушёл в работу (work_started_at), а не с создания.
const ACTIVE = ['printing', 'to_collect', 'collected'];
const TO_PRODUCE = ['printing', 'to_collect'];
const FORECAST_WEEKS = 4;
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const ts = (iso) => new Date(iso).getTime();
const started = (o) => o.work_started_at || o.created_at;
const units = (items) => items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);
const round1 = (n) => Math.round(n * 10) / 10;

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function durationStats(ms) {
  const sorted = ms.slice().sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, avg_hours: null, median_hours: null, p90_hours: null };
  const avg = sorted.reduce((s, x) => s + x, 0) / sorted.length;
  return {
    count: sorted.length,
    avg_hours: round1(avg / HOUR),
    median_hours: round1(percentile(sorted, 50) / HOUR),
    p90_hours: round1(percentile(sorted, 90) / HOUR),
  };
}

// Интервалы графика: до месяца — по дням, до полугода — по неделям (с понедельника), дальше — по месяцам.
function makeBuckets(since, now, periodDays) {
  const unit = periodDays <= 31 ? 'day' : periodDays <= 186 ? 'week' : 'month';
  const start = new Date(since);
  start.setHours(0, 0, 0, 0);
  if (unit === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  if (unit === 'month') start.setDate(1);
  const buckets = [];
  for (let d = new Date(start); d.getTime() <= now; ) {
    const from = new Date(d);
    if (unit === 'day') d.setDate(d.getDate() + 1);
    else if (unit === 'week') d.setDate(d.getDate() + 7);
    else d.setMonth(d.getMonth() + 1);
    buckets.push({ from: from.getTime(), to: d.getTime(), date: localDate(from), created: 0, shipped: 0, created_units: 0 });
  }
  return { unit, buckets };
}

function bucketFor(buckets, t) {
  return buckets.find((b) => t >= b.from && t < b.to);
}

// Группировка с долей и темпом в неделю (для прогноза спроса).
function mix(entries, weeks, describe) {
  const map = new Map();
  for (const { key, qty } of entries) {
    if (!qty) continue;
    map.set(key, (map.get(key) || 0) + qty);
  }
  const total = [...map.values()].reduce((s, x) => s + x, 0);
  return [...map.entries()]
    .map(([key, qty]) => ({
      key,
      ...describe(key),
      qty,
      share: total ? round1((qty / total) * 100) : 0,
      per_week: round1(qty / weeks),
      forecast: Math.round((qty / weeks) * FORECAST_WEEKS),
    }))
    .sort((a, b) => b.qty - a.qty);
}

// Сколько заказ провёл в каждом статусе: разница между соседними записями истории.
// Считаются только завершённые этапы, закончившиеся в выбранном периоде; этап, закончившийся отменой, не в счёт.
function stageDurations(since) {
  const rows = db.prepare('SELECT order_id, status, at FROM order_status_log ORDER BY order_id, at, id').all();
  const byStatus = new Map();
  for (let i = 0; i < rows.length - 1; i++) {
    const cur = rows[i];
    const next = rows[i + 1];
    if (next.order_id !== cur.order_id) continue;
    if (['cancelled', 'delivered', ...PRE_WORK_STATUSES].includes(cur.status) || next.status === 'cancelled') continue;
    const end = ts(next.at);
    if (end < since) continue;
    if (!byStatus.has(cur.status)) byStatus.set(cur.status, []);
    byStatus.get(cur.status).push(end - ts(cur.at));
  }
  return STATUSES.filter((s) => byStatus.has(s.id)).map((s) => ({ status: s.id, label: s.label, ...durationStats(byStatus.get(s.id)) }));
}

export function getStats({ days = 30 } = {}) {
  const now = Date.now();
  const all = listOrders();
  const earliest = all.length ? Math.min(...all.map((o) => ts(o.created_at))) : now;
  const since = days > 0 ? now - days * DAY : earliest;
  const periodDays = Math.max(1, (now - since) / DAY);
  const weeks = periodDays / 7;

  const live = all.filter((o) => o.status !== 'cancelled' && !PRE_WORK_STATUSES.includes(o.status));
  const created = live.filter((o) => ts(started(o)) >= since);
  const cancelled = all.filter((o) => o.status === 'cancelled' && ts(o.created_at) >= since);
  const shipped = live.filter((o) => o.shipped_at && ts(o.shipped_at) >= since);
  const active = live.filter((o) => ACTIVE.includes(o.status));
  const toProduce = live.filter((o) => TO_PRODUCE.includes(o.status));

  const revenue = created.reduce((s, o) => s + o.grand_total, 0);
  const createdUnits = created.reduce((s, o) => s + units(o.items), 0);
  const shippedUnits = shipped.reduce((s, o) => s + units(o.items), 0);
  const backlogUnits = toProduce.reduce((s, o) => s + units(o.items), 0);
  const shippedUnitsPerDay = shippedUnits / periodDays;

  const withDeadline = shipped.filter((o) => o.ship_deadline_at);
  const onTime = withDeadline.filter((o) => ts(o.shipped_at) <= ts(o.ship_deadline_at)).length;
  const overdue = active.filter((o) => o.ship_deadline_at && now > ts(o.ship_deadline_at));

  // Поток: сколько пришло и сколько ушло по интервалам.
  const { unit, buckets } = makeBuckets(since, now, periodDays);
  for (const o of created) {
    const b = bucketFor(buckets, ts(started(o)));
    if (b) {
      b.created++;
      b.created_units += units(o.items);
    }
  }
  for (const o of shipped) {
    const b = bucketFor(buckets, ts(o.shipped_at));
    if (b) b.shipped++;
  }

  // Что нужно произвести прямо сейчас: товары незасобранных заказов, сгруппированные до цвета и разъёма.
  const backlogMap = new Map();
  const printMap = new Map();
  for (const o of toProduce) {
    for (const it of o.items) {
      const qty = Number(it.quantity) || 0;
      if (it.item_kind === 'print') {
        const key = [it.material || '—', it.finish || ''].join('|');
        const row = printMap.get(key) || { material: it.material || '—', finish: it.finish || '', qty: 0, orders: new Set() };
        row.qty += qty;
        row.orders.add(o.id);
        printMap.set(key, row);
        continue;
      }
      const key = [it.product_name || 'Товар', it.color || '', it.connector || ''].join('|');
      const row = backlogMap.get(key) || {
        product: it.product_name || 'Товар',
        color: it.color || '',
        color_label: colorShortLabel(it.color),
        color_swatch: COLORS.find((c) => c.letter === it.color)?.swatch || null,
        connector: it.connector || '',
        connector_label: connectorLabel(it.connector),
        qty: 0,
        orders: new Set(),
        oldest: started(o),
      };
      row.qty += qty;
      row.orders.add(o.id);
      if (started(o) < row.oldest) row.oldest = started(o);
      backlogMap.set(key, row);
    }
  }
  const setToCount = (r) => ({ ...r, orders: r.orders.size });

  // Спрос за период — основа для закупки комплектующих и пластика.
  const hwItems = created.flatMap((o) => o.items.filter((it) => it.item_kind !== 'print'));
  const printItems = created.flatMap((o) => o.items.filter((it) => it.item_kind === 'print'));
  const q = (it) => Number(it.quantity) || 0;

  const weekday = WEEKDAYS.map((label) => ({ label, orders: 0 }));
  for (const o of created) weekday[(new Date(started(o)).getDay() + 6) % 7].orders++;

  return {
    period: { days, since: new Date(since).toISOString(), period_days: round1(periodDays), unit },
    kpi: {
      created: created.length,
      created_units: createdUnits,
      revenue,
      avg_check: created.length ? revenue / created.length : 0,
      cancelled: cancelled.length,
      shipped: shipped.length,
      shipped_units: shippedUnits,
      orders_per_week: round1(created.length / weeks),
      units_per_week: round1(createdUnits / weeks),
      shipped_units_per_week: round1(shippedUnits / weeks),
      active: active.length,
      to_produce: toProduce.length,
      backlog_units: backlogUnits,
      waiting_shipment: live.filter((o) => o.status === 'collected').length,
      overdue: overdue.length,
      // Бэклог закроется примерно за N дней при текущем темпе отправки.
      backlog_days: shippedUnitsPerDay > 0 ? round1(backlogUnits / shippedUnitsPerDay) : null,
      on_time_percent: withDeadline.length ? round1((onTime / withDeadline.length) * 100) : null,
      lead_time: durationStats(shipped.map((o) => ts(o.shipped_at) - ts(started(o)))),
    },
    flow: buckets.map(({ date, created: c, shipped: s, created_units: u }) => ({ date, created: c, shipped: s, created_units: u })),
    backlog: [...backlogMap.values()].map(setToCount).sort((a, b) => b.qty - a.qty || a.oldest.localeCompare(b.oldest)),
    print_backlog: [...printMap.values()].map(setToCount).sort((a, b) => b.qty - a.qty),
    overdue_orders: overdue
      .sort((a, b) => ts(a.ship_deadline_at) - ts(b.ship_deadline_at))
      .slice(0, 10)
      .map((o) => ({
        id: o.id,
        display_number: o.display_number,
        full_name: o.full_name,
        status: o.status,
        created_at: o.created_at,
        ship_deadline_at: o.ship_deadline_at,
      })),
    demand: {
      weeks: round1(weeks),
      forecast_weeks: FORECAST_WEEKS,
      products: mix(hwItems.map((it) => ({ key: it.product_name || 'Товар', qty: q(it) })), weeks, (k) => ({ label: k })),
      colors: mix(hwItems.filter((it) => it.color).map((it) => ({ key: it.color, qty: q(it) })), weeks, (k) => ({
        label: colorShortLabel(k),
        swatch: COLORS.find((c) => c.letter === k)?.swatch || null,
      })),
      connectors: mix(hwItems.filter((it) => it.connector).map((it) => ({ key: it.connector, qty: q(it) })), weeks, (k) => ({
        label: connectorLabel(k),
        swatch: CONNECTORS.find((c) => c.letter === k)?.swatch || null,
      })),
      materials: mix(printItems.map((it) => ({ key: it.material || '—', qty: q(it) })), weeks, (k) => ({ label: k })),
      delivery: mix(created.map((o) => ({ key: o.delivery_service || '—', qty: 1 })), weeks, (k) => ({
        label: k,
        swatch: DELIVERY_SERVICES.find((d) => d.label === k)?.swatch || null,
      })),
      sources: mix(created.map((o) => ({ key: o.source_label, qty: 1 })), weeks, (k) => ({ label: k })),
    },
    weekday,
    stages: stageDurations(since),
  };
}
