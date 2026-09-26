async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Ошибка запроса' }));
    throw new Error(err.error || 'Ошибка запроса');
  }
  return res.json();
}

function money(n) {
  return Number(n || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽';
}

function statusPill(status, statuses) {
  const s = statuses.find((x) => x.id === status);
  const label = s ? s.label : status;
  return `<span class="pill ${status}">${label}</span>`;
}

// Кружок-метка нужного цвета перед текстом — для цвета товара, разъёма, ТК.
function dot(hex) {
  return `<span class="dot" style="background:${hex || '#6b7280'}"></span>`;
}

function findSwatch(list, key, value) {
  return list.find((x) => x[key] === value)?.swatch;
}

// ТК хранится как текст (label), а не id — ищем по совпадению названия.
function deliveryDot(label, deliveryServices) {
  const swatch = findSwatch(deliveryServices || [], 'label', label);
  return dot(swatch);
}

function colorDot(letter, colors) {
  return dot(findSwatch(colors || [], 'letter', letter));
}

function connectorDot(letter, connectors) {
  return dot(findSwatch(connectors || [], 'letter', letter));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Плашки товара для карточек: модель, цвет, разъём, количество.
// Использует глобальный catalog страницы (models/colors/connectors), если он есть.
function itemChips(it) {
  const cat = (typeof catalog !== 'undefined' && catalog) || {};
  const model = (cat.models || []).find((m) => m.id === it.model_id);
  const color = (cat.colors || []).find((c) => c.letter === it.color);
  const conn = (cat.connectors || []).find((c) => c.letter === it.connector);
  const chips = [];
  if (model || it.model_id) chips.push(`<span class="chip">${escapeHtml(model?.label || it.model_id)}</span>`);
  if (color || it.color) chips.push(`<span class="chip">${dot(color?.swatch)}${escapeHtml(color?.shortLabel || color?.label || it.color)}</span>`);
  if (conn || it.connector) chips.push(`<span class="chip">${dot(conn?.swatch)}${escapeHtml(conn?.plugLabel || conn?.label || it.connector)}</span>`);
  if (Number(it.quantity) > 1) chips.push(`<span class="chip chip-qty">× ${it.quantity}</span>`);
  return chips.join('');
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstChild;
}

// "Автоматический лоадер, Автоматический лоадер, Автоматический лоадер" -> "Автоматический лоадер 3шт"
// Используется везде, кроме вкладки "Сборка", где нужны отдельные строки с цветом/разъёмом.
function summarizeItems(items) {
  const totals = new Map();
  for (const it of items) {
    const name = it.product_name || 'Товар';
    totals.set(name, (totals.get(name) || 0) + (Number(it.quantity) || 0));
  }
  return [...totals.entries()].map(([name, qty]) => (qty > 1 ? `${name} ${qty}шт` : name)).join(', ');
}

// Стилизованные под сайт замены alert()/confirm() — вместо голых системных всплывашек браузера.
function toast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = el('<div class="toast-container" id="toast-container"></div>');
    document.body.appendChild(container);
  }
  const t = el(`<div class="toast ${type}">${message}</div>`);
  container.appendChild(t);
  setTimeout(() => {
    t.classList.add('toast-out');
    setTimeout(() => t.remove(), 200);
  }, 3200);
}

function confirmDialog(message, { okLabel = 'Подтвердить', danger = true } = {}) {
  return new Promise((resolve) => {
    const overlay = el(`
      <div class="modal-overlay">
        <div class="modal-box">
          <p>${message}</p>
          <div class="modal-actions">
            <button type="button" class="secondary" id="modal-cancel">Отмена</button>
            <button type="button" class="${danger ? 'danger' : ''}" id="modal-ok">${okLabel}</button>
          </div>
        </div>
      </div>
    `);
    document.body.appendChild(overlay);
    const close = (result) => {
      overlay.remove();
      resolve(result);
    };
    overlay.querySelector('#modal-cancel').addEventListener('click', () => close(false));
    overlay.querySelector('#modal-ok').addEventListener('click', () => close(true));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
    });
  });
}

// Боковая панель навигации: сворачивается в узкую иконочную полоску, состояние помнится в браузере.
function initSidebar() {
  const sidebar = document.getElementById('sidebar');
  const toggle = document.getElementById('sidebar-toggle');
  if (!sidebar || !toggle) return;
  const KEY = 'sidebar-collapsed';
  // Пока пользователь сам не переключал: на узких/вертикальных мониторах — свёрнута.
  let collapsed = window.innerWidth < 1280;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === '1' || saved === '0') collapsed = saved === '1';
  } catch {
    // localStorage может быть недоступен — не критично, просто не запомним состояние
  }
  if (collapsed) sidebar.classList.add('collapsed');
  toggle.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    try {
      localStorage.setItem(KEY, sidebar.classList.contains('collapsed') ? '1' : '0');
    } catch {
      // см. выше
    }
  });
}
initSidebar();

// Тег происхождения заказа: «Сайт» (пришёл из New_Lab_3d) или «CRM» (создан в самой CRM).
function tagBadge(order) {
  return `<span class="tag tag-${order.source_tag || 'crm'}" title="Откуда заказ">${escapeHtml(order.source_label || 'CRM')}</span>`;
}

// Подписи ячеек для «карточного» вида таблиц на узких экранах: data-label = заголовок колонки.
// Строки добавляются динамически, поэтому следим за изменениями DOM.
function labelTableCells() {
  for (const table of document.querySelectorAll('table.orders-table, table.items-table')) {
    const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    if (!headers.length) continue;
    for (const row of table.querySelectorAll('tbody tr')) {
      [...row.children].forEach((td, i) => {
        if (td.tagName === 'TD' && !td.hasAttribute('data-label') && headers[i]) td.setAttribute('data-label', headers[i]);
      });
    }
  }
}
let labelTimer = null;
new MutationObserver(() => {
  clearTimeout(labelTimer);
  labelTimer = setTimeout(labelTableCells, 30);
}).observe(document.documentElement, { childList: true, subtree: true });
labelTableCells();

// Текущий сотрудник + кнопка "Выйти" внизу сайдбара (пользователи — в Настройках, только для админа).
async function initSidebarUser() {
  const mount = document.getElementById('sidebar-user');
  if (!mount) return;
  let me;
  try {
    me = await api('/api/auth/me');
  } catch {
    return;
  }
  mount.innerHTML = `
    <div>
      <div class="username">${me.username}</div>
      <span class="role">${me.role === 'admin' ? 'Администратор' : 'Сотрудник'}</span>
    </div>
    <button type="button" class="secondary small logout-btn" id="logout-btn" title="Выйти" aria-label="Выйти">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>
      </svg>
    </button>
  `;
  // Разделы только для администратора (Бухгалтерия) — в меню показываем лишь ему.
  if (me.role === 'admin') document.querySelectorAll('[data-admin-only]').forEach((a) => { a.hidden = false; });
  mount.querySelector('#logout-btn').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

  // Админка основного сайта (лаборатория 3D) — из CRM переключаемся туда, из админки — обратно сюда.
  if (me.role === 'admin') {
    try {
      const { site_admin_url: adminUrl } = await api('/api/config');
      const nav = document.querySelector('.sidebar-nav');
      if (adminUrl && nav && !nav.querySelector('a[data-site-admin]')) {
        const link = el(`<a href="${adminUrl}" data-site-admin><span class="nav-icon">🛠</span><span class="label">Админка сайта</span></a>`);
        nav.appendChild(link);
      }
    } catch {
      // без ссылки на админку CRM работает как обычно
    }
  }
}
initSidebarUser();

// Только для "устанавливаемости" (Chrome/Android "Добавить на экран") — без офлайн-кеша,
// данные о заказах всегда должны быть живые.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// Проверка серийных номеров в форме заказа: повтор внутри заказа и занятость в других заказах.
// Работает для любых полей name="serial_number" в #items-table (строки добавляются динамически).
const serialCheckTimers = new WeakMap();
function serialWarning(input) {
  const cell = input.closest('td');
  let note = cell.querySelector('.serial-warning');
  if (!note) {
    note = document.createElement('div');
    note.className = 'serial-warning';
    cell.appendChild(note);
  }
  return note;
}
async function checkSerialInput(input) {
  const value = input.value.trim().toUpperCase();
  const note = serialWarning(input);
  const setState = (text) => {
    note.textContent = text;
    input.classList.toggle('invalid', Boolean(text));
  };
  if (!value) return setState('');
  const others = [...document.querySelectorAll('#items-table [name="serial_number"]')]
    .filter((el) => el !== input && el.value.trim().toUpperCase() === value);
  if (others.length) return setState('Этот номер уже есть в этом заказе');
  try {
    const params = new URLSearchParams({ serial: value });
    if (window.CURRENT_ORDER_ID) params.set('order_id', window.CURRENT_ORDER_ID);
    const res = await api(`/api/serials/check?${params}`);
    if (input.value.trim().toUpperCase() !== value) return; // успели поменять
    setState(res.taken ? `Занят в заказе #${res.order_number}` : '');
  } catch {
    // проверка не удалась — окончательно проверит сервер при сохранении
  }
}
document.addEventListener('input', (e) => {
  const input = e.target;
  if (!(input instanceof HTMLInputElement) || input.name !== 'serial_number' || !input.closest('#items-table')) return;
  clearTimeout(serialCheckTimers.get(input));
  serialCheckTimers.set(input, setTimeout(() => {
    // перепроверяем все поля: повтор мог исчезнуть и у соседней строки
    document.querySelectorAll('#items-table [name="serial_number"]').forEach(checkSerialInput);
  }, 300));
});

// ---- Каталог товаров в форме заказа ----
// Товар из каталога (Настройки → Каталог) по названию.
function productTemplate(name) {
  const cat = (typeof catalog !== 'undefined' && catalog) || {};
  return (cat.products || []).find((p) => p.label === name) || null;
}

// Подставить модель/цену из каталога в строку товара. Цену меняем, только если она пустая/0
// или если force (товар выбрали заново).
function applyProductTemplate(row, template, { force = false } = {}) {
  if (!row || !template) return;
  const model = row.querySelector('select[name="model_id"]');
  if (model && template.model_id) {
    model.value = template.model_id;
    model.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const price = row.querySelector('input[name="price"]');
  if (price && template.price > 0 && (force || !(Number(price.value) > 0))) {
    price.value = template.price;
    price.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

// Выбрали другой товар в строке — подставляем его модель и цену.
document.addEventListener('change', (e) => {
  const select = e.target;
  if (!(select instanceof HTMLSelectElement) || select.name !== 'product_name' || !select.closest('#items-table')) return;
  applyProductTemplate(select.closest('tr'), productTemplate(select.value), { force: true });
});

// Кнопки «быстро добавить» над списком товаров. addRow(values) — функция страницы.
function renderQuickAdd(mount, addRow) {
  const cat = (typeof catalog !== 'undefined' && catalog) || {};
  const products = (cat.products || []).filter((p) => p.price > 0 || p.model_id || p.weight_g > 0);
  mount.innerHTML = '';
  if (!products.length) {
    mount.innerHTML = '<span class="muted" style="font-size:12px">Товары для быстрого добавления настраиваются в Настройках → Каталог.</span>';
    return;
  }
  mount.appendChild(el('<span class="muted" style="font-size:12px">Быстро добавить:</span>'));
  for (const p of products) {
    const btn = el(`<button type="button" class="chip quick-chip">＋ ${escapeHtml(p.label)}${p.price > 0 ? ` · ${money(p.price)}` : ''}</button>`);
    btn.addEventListener('click', () => {
      // Пустая строка (новый заказ) заполняется, иначе добавляется новая.
      const rows = [...document.querySelectorAll('#items-table tbody tr')];
      const blank = rows.find((r) => {
        const price = r.querySelector('input[name="price"]');
        const serial = r.querySelector('input[name="serial_number"]');
        return price && !(Number(price.value) > 0) && !(serial && serial.value.trim()) && !r.dataset.itemId;
      });
      if (blank) {
        const select = blank.querySelector('select[name="product_name"]');
        if (select) {
          if (![...select.options].some((o) => o.value === p.label)) select.appendChild(el(`<option value="${escapeHtml(p.label)}">${escapeHtml(p.label)}</option>`));
          select.value = p.label;
        }
        applyProductTemplate(blank, p, { force: true });
      } else {
        addRow({ product_name: p.label, model_id: p.model_id || undefined, price: p.price || 0, quantity: 1 });
      }
    });
    mount.appendChild(btn);
  }
}
