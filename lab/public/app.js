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
    <button type="button" class="secondary small" id="logout-btn" title="Выйти">⏻</button>
  `;
  mount.querySelector('#logout-btn').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

}
initSidebarUser();

// Только для "устанавливаемости" (Chrome/Android "Добавить на экран") — без офлайн-кеша,
// данные о заказах всегда должны быть живые.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
