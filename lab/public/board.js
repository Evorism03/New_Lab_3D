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

function render(orders) {
  const board = document.getElementById('board');
  board.innerHTML = '';
  const searching = Boolean(document.getElementById('search').value.trim());
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
        <div class="order-card" draggable="true" data-id="${o.id}">
          <div class="name">#${escapeHtml(o.display_number)} ${tagBadge(o)} ${o.full_name || 'Без имени'}${o.receipts_count ? ` <span title="${o.receipts_count} чек(ов)">📎${o.receipts_count}</span>` : ''}</div>
          <div class="meta">${deliveryDot(o.delivery_service, catalog.delivery_services)}${o.delivery_service || ''} · ${o.pvz_address || ''}</div>
          <div class="meta">${itemsSummary}</div>
          ${filesLine(o)}
          <div class="total">${money(o.grand_total)}</div>
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
      card.addEventListener('click', () => { window.location.href = `/order.html?id=${o.id}`; });
      cardsWrap.appendChild(card);
    }
    col.addEventListener('dragover', (e) => {
      // В «Печать» — только заказы с сайта: для CRM-заказа колонка не принимает drop.
      if (s.id === 'printing' && !draggedIsSite) {
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
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('dragover');
      if (draggedId == null) return;
      const id = draggedId;
      draggedId = null;
      try {
        if (searching) {
          await api(`/api/orders/${id}`, { method: 'PATCH', body: JSON.stringify({ status: s.id }) });
        } else {
          // Новый порядок колонки: все карточки кроме перетаскиваемой + она на месте плейсхолдера.
          const ids = [];
          for (const node of cardsWrap.children) {
            if (node === placeholder) ids.push(id);
            else if (node.dataset.id && Number(node.dataset.id) !== id) ids.push(Number(node.dataset.id));
          }
          if (!ids.includes(id)) ids.push(id);
          placeholder.remove();
          await api('/api/board/reorder', { method: 'POST', body: JSON.stringify({ status: s.id, ids }) });
        }
      } catch (err) {
        // Например, заказ не с сайта пытались бросить в «Печать» — сервер откажет.
        toast(err.message, 'error');
      }
      load();
    });
    board.appendChild(col);
  }
}

document.getElementById('search').addEventListener('input', () => load());
load();
