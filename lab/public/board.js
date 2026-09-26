// Канбан-доска заказов. Колонка «Печать» — только для заказов с сайта (сервер это тоже проверяет).

let statuses = [];
let catalog = { delivery_services: [] };
let draggedId = null;
let draggedIsSite = false;

async function load() {
  const q = document.getElementById('search').value.trim();
  const [statusesData, catalogData, orders] = await Promise.all([
    statuses.length ? Promise.resolve(statuses) : api('/api/statuses'),
    catalog.delivery_services.length ? Promise.resolve(catalog) : api('/api/catalog'),
    api('/api/orders' + (q ? `?q=${encodeURIComponent(q)}` : '')),
  ]);
  statuses = statusesData;
  catalog = catalogData;
  render(orders);
}

// Порядок в колонке: ещё не двигавшиеся вручную (новые) — сверху, от новых к старым;
// дальше — в том порядке, в каком их расставили перетаскиванием.
function sortColumn(list) {
  return list.slice().sort((a, b) => {
    const pa = a.board_position, pb = b.board_position;
    if (pa == null && pb == null) return b.id - a.id;
    if (pa == null) return -1;
    if (pb == null) return 1;
    return pa - pb || b.id - a.id;
  });
}

const placeholder = el('<div class="card-placeholder"></div>');

// Карточка, перед которой нужно вставить перетаскиваемую (по положению курсора).
function cardAfter(cardsWrap, y) {
  const cards = [...cardsWrap.querySelectorAll('.order-card:not(.dragging)')];
  return cards.find((c) => {
    const r = c.getBoundingClientRect();
    return y < r.top + r.height / 2;
  }) || null;
}


function filesLine(o) {
  const names = [...new Set(o.items.map((it) => it.source_file).filter(Boolean))];
  return names.length ? `<div class="meta">📄 ${names.map(escapeHtml).join(', ')}</div>` : '';
}

// В «Печать» — только заказы с сайта (сервер проверяет то же самое).
function canDropIn(statusId, isSite) {
  return !(statusId === 'printing' && !isSite);
}

const isSearching = () => Boolean(document.getElementById('search').value.trim());

// Перенос заказа в колонку. Без поиска — с порядком (по плейсхолдеру), при поиске / из выпадашки — только статус.
async function commitMove(id, statusId, cardsWrap, statusOnly) {
  try {
    if (statusOnly || !cardsWrap) {
      await api(`/api/orders/${id}`, { method: 'PATCH', body: JSON.stringify({ status: statusId }) });
    } else {
      // Новый порядок колонки: все карточки кроме перетаскиваемой + она на месте плейсхолдера.
      const ids = [];
      for (const node of cardsWrap.children) {
        if (node === placeholder) ids.push(id);
        else if (node.dataset.id && Number(node.dataset.id) !== id) ids.push(Number(node.dataset.id));
      }
      if (!ids.includes(id)) ids.push(id);
      await api('/api/board/reorder', { method: 'POST', body: JSON.stringify({ status: statusId, ids }) });
    }
  } catch (err) {
    // Например, заказ не с сайта пытались бросить в «Печать» — сервер откажет.
    toast(err.message, 'error');
  }
  placeholder.remove();
  load();
}

// ---- Перетаскивание пальцем ----
// HTML5 drag-and-drop на телефоне почти не работает, поэтому на сенсорных экранах свой вариант:
// карточку берём долгим нажатием, дальше она «прилипает» к пальцу; у края экрана доска сама прокручивается.
const IS_TOUCH = window.matchMedia('(pointer: coarse)').matches;
const LONG_PRESS_MS = 350;
let td = null; // текущее касание
let suppressClick = false;

function colFromPoint(x, y) {
  const at = document.elementFromPoint(x, y);
  return at ? at.closest('.board-col') : null;
}

function updateTouchTarget() {
  document.querySelectorAll('.board-col.dragover').forEach((c) => c.classList.remove('dragover'));
  const col = colFromPoint(td.x, td.y);
  td.target = null;
  if (!col || !canDropIn(col.dataset.status, td.isSite)) return;
  td.target = col;
  col.classList.add('dragover');
  if (isSearching()) return;
  const cardsWrap = col.querySelector('.cards');
  const before = cardAfter(cardsWrap, td.y);
  if (before) cardsWrap.insertBefore(placeholder, before);
  else cardsWrap.appendChild(placeholder);
}

function moveGhost() {
  td.ghost.style.transform = `translate(${td.x - td.offX}px, ${td.y - td.offY}px)`;
}

function autoscrollTick() {
  if (!td || !td.active) return;
  const board = document.getElementById('board');
  let moved = false;
  if (td.x < 48) { board.scrollLeft -= 14; moved = true; }
  else if (td.x > window.innerWidth - 48) { board.scrollLeft += 14; moved = true; }
  if (td.y < 80) { window.scrollBy(0, -12); moved = true; }
  else if (td.y > window.innerHeight - 130) { window.scrollBy(0, 12); moved = true; }
  if (moved) updateTouchTarget();
  td.raf = requestAnimationFrame(autoscrollTick);
}

function activateTouchDrag() {
  if (!td) return;
  td.active = true;
  if (navigator.vibrate) navigator.vibrate(20);
  const rect = td.card.getBoundingClientRect();
  td.offX = td.x - rect.left;
  td.offY = td.y - rect.top;
  td.ghost = td.card.cloneNode(true);
  td.ghost.classList.add('touch-ghost');
  td.ghost.style.width = `${rect.width}px`;
  document.body.appendChild(td.ghost);
  placeholder.style.height = `${rect.height}px`;
  td.card.classList.add('dragging', 'touch-drag');
  document.body.classList.add('is-dragging');
  moveGhost();
  updateTouchTarget();
  td.raf = requestAnimationFrame(autoscrollTick);
}

function cleanupTouchDrag() {
  if (!td) return;
  clearTimeout(td.timer);
  cancelAnimationFrame(td.raf);
  if (td.ghost) td.ghost.remove();
  td.card.classList.remove('dragging', 'touch-drag');
  document.body.classList.remove('is-dragging');
  document.querySelectorAll('.board-col.dragover').forEach((c) => c.classList.remove('dragover'));
}

function attachTouchDrag(card, o) {
  card.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const p = e.touches[0];
    td = { card, id: o.id, isSite: o.source_tag === 'site', startX: p.clientX, startY: p.clientY, x: p.clientX, y: p.clientY, active: false, target: null };
    td.timer = setTimeout(activateTouchDrag, LONG_PRESS_MS);
  }, { passive: true });

  card.addEventListener('touchmove', (e) => {
    if (!td || td.card !== card) return;
    const p = e.touches[0];
    td.x = p.clientX;
    td.y = p.clientY;
    if (!td.active) {
      // Палец поехал до долгого нажатия — это обычная прокрутка, перетаскивание не начинаем.
      if (Math.hypot(td.x - td.startX, td.y - td.startY) > 10) { clearTimeout(td.timer); td = null; }
      return;
    }
    e.preventDefault(); // во время переноса страница не должна скроллиться
    moveGhost();
    updateTouchTarget();
  }, { passive: false });

  const finish = async (e) => {
    if (!td || td.card !== card) return;
    const wasActive = td.active;
    const target = td.target;
    const id = td.id;
    cleanupTouchDrag();
    td = null;
    if (!wasActive) return;
    if (e.cancelable) e.preventDefault();
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 400);
    if (e.type === 'touchend' && target) {
      await commitMove(id, target.dataset.status, target.querySelector('.cards'), isSearching());
    } else {
      placeholder.remove();
    }
  };
  card.addEventListener('touchend', finish);
  card.addEventListener('touchcancel', finish);
  // Долгое нажатие иначе открывает меню браузера (сохранить / копировать).
  card.addEventListener('contextmenu', (e) => e.preventDefault());
}

function moveOptions(o) {
  return statuses
    .filter((s) => s.id !== 'cancelled' && s.id !== o.status && canDropIn(s.id, o.source_tag === 'site'))
    .map((s) => `<option value="${s.id}">${s.label}</option>`)
    .join('');
}

function render(orders) {
  const board = document.getElementById('board');
  board.innerHTML = '';
  const searching = isSearching();
  const visibleStatuses = statuses.filter((s) => s.id !== 'cancelled');
  for (const s of visibleStatuses) {
    const colOrders = sortColumn(orders.filter((o) => o.status === s.id));
    const col = el(`
      <div class="board-col" data-status="${s.id}">
        <h3><span>${s.label}</span><span>${colOrders.length}</span></h3>
        <div class="cards"></div>
      </div>
    `);
    const cardsWrap = col.querySelector('.cards');
    for (const o of colOrders) {
      const itemsSummary = summarizeItems(o.items) || '—';
      const card = el(`
        <div class="order-card" draggable="${IS_TOUCH ? 'false' : 'true'}" data-id="${o.id}">
          <div class="name">#${escapeHtml(o.display_number)} ${tagBadge(o)} ${o.full_name || 'Без имени'}${o.receipts_count ? ` <span title="Файлов прикреплено: ${o.receipts_count}">📎${o.receipts_count}</span>` : ''}</div>
          <div class="meta">${deliveryDot(o.delivery_service, catalog.delivery_services)}${o.delivery_service || ''} · ${o.pvz_address || ''}</div>
          <div class="meta">${itemsSummary}</div>
          ${filesLine(o)}
          <div class="total">${money(o.grand_total)}</div>
          <select class="card-move" aria-label="Переместить заказ"><option value="">⇄ Переместить в…</option>${moveOptions(o)}</select>
        </div>
      `);
      card.addEventListener('dragstart', (e) => {
        draggedId = o.id;
        draggedIsSite = o.source_tag === 'site';
        e.dataTransfer.effectAllowed = 'move';
        placeholder.style.height = `${card.offsetHeight}px`;
        requestAnimationFrame(() => card.classList.add('dragging'));
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        placeholder.remove();
        document.querySelectorAll('.board-col.dragover').forEach((c) => c.classList.remove('dragover'));
      });
      card.addEventListener('click', () => {
        if (suppressClick) return;
        window.location.href = `/order.html?id=${o.id}`;
      });
      // Запасной способ для телефона: выбрать колонку из списка на карточке.
      const move = card.querySelector('.card-move');
      move.addEventListener('click', (e) => e.stopPropagation());
      move.addEventListener('change', () => { if (move.value) commitMove(o.id, move.value, null, true); });
      attachTouchDrag(card, o);
      cardsWrap.appendChild(card);
    }
    col.addEventListener('dragover', (e) => {
      // В «Печать» — только заказы с сайта: для CRM-заказа колонка не принимает drop.
      if (!canDropIn(s.id, draggedIsSite)) {
        e.dataTransfer.dropEffect = 'none';
        return;
      }
      e.preventDefault();
      col.classList.add('dragover');
      // При поиске видна только часть карточек — порядок не меняем, только колонку.
      if (searching) return;
      const before = cardAfter(cardsWrap, e.clientY);
      if (before) cardsWrap.insertBefore(placeholder, before);
      else cardsWrap.appendChild(placeholder);
    });
    col.addEventListener('dragleave', (e) => {
      if (!col.contains(e.relatedTarget)) {
        col.classList.remove('dragover');
        placeholder.remove();
      }
    });
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('dragover');
      if (draggedId == null) return;
      const id = draggedId;
      draggedId = null;
      commitMove(id, s.id, cardsWrap, searching);
    });
    board.appendChild(col);
  }
}

document.getElementById('search').addEventListener('input', () => load());
load();
