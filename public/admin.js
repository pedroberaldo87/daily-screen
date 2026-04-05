const API = '/api';

const WEEKDAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const CATEGORY_LABELS = {
  medication: 'Medicamento',
  supplement: 'Suplemento',
  reminder: 'Lembrete',
};

// ═══ Items List ═══

async function loadItems() {
  const res = await fetch(`${API}/items`);
  const items = await res.json();
  renderItems(items);
}

function renderItems(items) {
  const container = document.getElementById('items-list');
  container.innerHTML = '';

  for (const item of items) {
    const weekdays = JSON.parse(item.weekdays || '[0,1,2,3,4,5,6]');
    const weekdayStr = weekdays.length === 7
      ? 'Todo dia'
      : weekdays.map(d => WEEKDAY_NAMES[d]).join(', ');

    const countInfo = item.total_count
      ? `${item.completed_count}/${item.total_count}`
      : '';

    const card = document.createElement('div');
    card.className = `item-card${item.active ? '' : ' inactive'}`;
    card.innerHTML = `
      <span class="item-icon">${escapeHtml(item.icon)}</span>
      <div class="item-info">
        <div class="item-title">${escapeHtml(item.title)}</div>
        <div class="item-meta">
          <span class="badge ${escapeHtml(item.category)}">${CATEGORY_LABELS[item.category] || escapeHtml(item.category)}</span>
          <span>${escapeHtml(weekdayStr)}</span>
          ${countInfo ? `<span class="count-badge">${countInfo}</span>` : ''}
          ${item.followup_title ? `<span style="color:var(--accent-rem)">→ ${escapeHtml(item.followup_title)}</span>` : ''}
          ${!item.active ? '<em style="color:var(--accent-danger)">Desativado</em>' : ''}
        </div>
      </div>
      <div class="item-actions">
        <button class="btn btn-sm btn-secondary" onclick="openEditModal(${item.id})">Editar</button>
        ${item.active
          ? `<button class="btn btn-sm btn-danger" onclick="deactivateItem(${item.id})">Desativar</button>`
          : `<button class="btn btn-sm btn-secondary" onclick="reactivateItem(${item.id})">Reativar</button>`
        }
        <button class="btn btn-sm btn-danger" onclick="confirmDelete(${item.id}, '${item.title.replace(/'/g, "\\'")}')">Deletar</button>
      </div>
    `;
    container.appendChild(card);
  }
}

// ═══ Quick Add ═══

async function quickAdd() {
  const title = document.getElementById('add-title').value.trim();
  const category = document.getElementById('add-category').value;
  const icon = document.getElementById('add-icon').value.trim() || '✅';
  const sort_order = Number(document.getElementById('add-sort').value) || 0;

  if (!title) return;

  await fetch(`${API}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, category, icon, sort_order }),
  });

  document.getElementById('add-title').value = '';
  document.getElementById('add-icon').value = '✅';
  document.getElementById('add-sort').value = '0';
  loadItems();
}

// ═══ Edit Modal ═══

let currentEditWeekdays = [0, 1, 2, 3, 4, 5, 6];

function setupWeekdayButtons() {
  document.querySelectorAll('#edit-weekdays .weekday-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const day = Number(btn.dataset.day);
      const idx = currentEditWeekdays.indexOf(day);
      if (idx >= 0) {
        currentEditWeekdays.splice(idx, 1);
        btn.classList.remove('active');
      } else {
        currentEditWeekdays.push(day);
        currentEditWeekdays.sort();
        btn.classList.add('active');
      }
    });
  });
}

async function openEditModal(id) {
  const res = await fetch(`${API}/items`);
  const items = await res.json();
  const item = items.find(i => i.id === id);
  if (!item) return;

  document.getElementById('edit-id').value = item.id;
  document.getElementById('edit-icon').value = item.icon;
  document.getElementById('edit-title').value = item.title;
  document.getElementById('edit-category').value = item.category;
  document.getElementById('edit-sort').value = item.sort_order;

  // Weekdays
  currentEditWeekdays = JSON.parse(item.weekdays || '[0,1,2,3,4,5,6]');
  document.querySelectorAll('#edit-weekdays .weekday-btn').forEach(btn => {
    const day = Number(btn.dataset.day);
    btn.classList.toggle('active', currentEditWeekdays.includes(day));
  });

  // Count & Alerts
  document.getElementById('edit-total-count').value = item.total_count || '';
  document.getElementById('edit-completed-count').value = item.completed_count || 0;
  document.getElementById('edit-alert-penultimate').value = item.alert_penultimate || '';
  document.getElementById('edit-alert-last').value = item.alert_last || '';

  // Follow-up
  document.getElementById('edit-followup-icon').value = item.followup_icon || '';
  document.getElementById('edit-followup-title').value = item.followup_title || '';
  document.getElementById('edit-followup-category').value = item.followup_category || '';

  document.getElementById('edit-modal').classList.add('active');
}

function closeModal() {
  document.getElementById('edit-modal').classList.remove('active');
}

document.getElementById('edit-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const id = document.getElementById('edit-id').value;
  const totalCount = document.getElementById('edit-total-count').value;

  const data = {
    title: document.getElementById('edit-title').value.trim(),
    category: document.getElementById('edit-category').value,
    icon: document.getElementById('edit-icon').value.trim(),
    sort_order: Number(document.getElementById('edit-sort').value) || 0,
    weekdays: JSON.stringify(currentEditWeekdays),
    total_count: totalCount ? Number(totalCount) : null,
    alert_penultimate: document.getElementById('edit-alert-penultimate').value.trim() || null,
    alert_last: document.getElementById('edit-alert-last').value.trim() || null,
    followup_title: document.getElementById('edit-followup-title').value.trim() || null,
    followup_category: document.getElementById('edit-followup-category').value || null,
    followup_icon: document.getElementById('edit-followup-icon').value.trim() || null,
  };

  await fetch(`${API}/items/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  closeModal();
  loadItems();
});

// Close modal on overlay click
document.getElementById('edit-modal').addEventListener('click', (e) => {
  if (e.target.id === 'edit-modal') closeModal();
});

// ═══ Deactivate / Reactivate / Delete ═══

async function deactivateItem(id) {
  await fetch(`${API}/items/${id}`, { method: 'DELETE' });
  loadItems();
}

async function reactivateItem(id) {
  await fetch(`${API}/items/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: 1 }),
  });
  loadItems();
}

// Confirm dialog
let pendingAction = null;

function confirmDelete(id, title) {
  document.getElementById('confirm-message').textContent =
    `Deletar "${title}" permanentemente? Isso remove o item e todo o histórico.`;
  document.getElementById('confirm-dialog').classList.add('active');
  pendingAction = async () => {
    await fetch(`${API}/items/${id}/permanent`, { method: 'DELETE' });
    loadItems();
  };
}

function closeConfirm() {
  document.getElementById('confirm-dialog').classList.remove('active');
  pendingAction = null;
}

document.getElementById('confirm-action').addEventListener('click', async () => {
  if (pendingAction) await pendingAction();
  closeConfirm();
});

// ═══ Location Search ═══

let searchTimeout = null;

async function loadLocation() {
  const res = await fetch(`${API}/settings`);
  const settings = await res.json();
  const el = document.getElementById('current-location');

  if (settings.weather_city) {
    el.textContent = `📍 ${settings.weather_city}`;
    el.style.display = 'block';
  }
}

document.getElementById('location-search').addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  const q = e.target.value.trim();
  if (q.length < 2) {
    document.getElementById('location-results').classList.remove('visible');
    return;
  }

  searchTimeout = setTimeout(async () => {
    const res = await fetch(`${API}/geocoding?q=${encodeURIComponent(q)}`);
    const results = await res.json();
    const container = document.getElementById('location-results');
    container.innerHTML = '';

    if (results.length === 0) {
      container.innerHTML = '<div class="search-result"><em style="color:var(--text-muted)">Nenhum resultado</em></div>';
    } else {
      for (const r of results) {
        const div = document.createElement('div');
        div.className = 'search-result';
        div.innerHTML = `${escapeHtml(r.name)} <small>${r.admin ? escapeHtml(r.admin) + ', ' : ''}${escapeHtml(r.country)}</small>`;
        div.addEventListener('click', () => selectLocation(r));
        container.appendChild(div);
      }
    }
    container.classList.add('visible');
  }, 400);
});

async function selectLocation(loc) {
  await fetch(`${API}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      weather_lat: String(loc.lat),
      weather_lon: String(loc.lon),
      weather_tz: loc.timezone,
      weather_city: `${loc.name}, ${loc.admin || loc.country}`,
    }),
  });

  document.getElementById('location-results').classList.remove('visible');
  document.getElementById('location-search').value = '';

  const el = document.getElementById('current-location');
  el.textContent = `📍 ${loc.name}, ${loc.admin || loc.country}`;
  el.style.display = 'block';
}

// Close search results on click outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-wrap')) {
    document.getElementById('location-results').classList.remove('visible');
  }
});

// ═══ Settings Modal ═══

function openSettingsModal() {
  document.getElementById('settings-modal').classList.add('active');
}

function closeSettingsModal() {
  document.getElementById('settings-modal').classList.remove('active');
}

document.getElementById('settings-modal').addEventListener('click', (e) => {
  if (e.target.id === 'settings-modal') closeSettingsModal();
});

// ═══ Font Size Panel ═══

const FONT_DEFAULTS = {
  font_clock: '3.6',
  font_greeting: '1.25',
  font_date: '0.88',
  font_weather_temp: '2',
  font_task_title: '1.05',
  font_col_header: '0.8',
  font_task_icon: '1.6',
  font_progress: '0.78',
  font_task_count: '0.6',
};

function setupFontSliders() {
  document.querySelectorAll('#font-panel input[type="range"]').forEach(slider => {
    const key = slider.dataset.key;
    const valueEl = document.getElementById('fv-' + slider.id.replace('fs-', ''));

    slider.addEventListener('input', () => {
      if (valueEl) valueEl.textContent = slider.value;
    });
  });
}

async function loadFonts() {
  const res = await fetch(`${API}/settings`);
  const settings = await res.json();

  for (const [key, defaultVal] of Object.entries(FONT_DEFAULTS)) {
    const val = settings[key] || defaultVal;
    const slider = document.querySelector(`input[data-key="${key}"]`);
    if (slider) {
      slider.value = val;
      const valueEl = document.getElementById('fv-' + slider.id.replace('fs-', ''));
      if (valueEl) valueEl.textContent = val;
    }
  }
}

async function saveFonts() {
  const data = {};
  document.querySelectorAll('#font-panel input[type="range"]').forEach(slider => {
    data[slider.dataset.key] = slider.value;
  });

  await fetch(`${API}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  // Brief visual feedback
  const btn = document.querySelector('#font-panel .btn-primary');
  const orig = btn.textContent;
  btn.textContent = 'Salvo!';
  btn.style.background = 'var(--accent-success)';
  setTimeout(() => { btn.textContent = orig; btn.style.background = ''; }, 1500);
}

async function resetFonts() {
  // Reset sliders to defaults
  for (const [key, val] of Object.entries(FONT_DEFAULTS)) {
    const slider = document.querySelector(`input[data-key="${key}"]`);
    if (slider) {
      slider.value = val;
      const valueEl = document.getElementById('fv-' + slider.id.replace('fs-', ''));
      if (valueEl) valueEl.textContent = val;
    }
  }

  // Save defaults
  await fetch(`${API}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(FONT_DEFAULTS),
  });

  const btn = document.querySelector('#font-panel .btn-secondary');
  const orig = btn.textContent;
  btn.textContent = 'Restaurado!';
  setTimeout(() => { btn.textContent = orig; }, 1500);
}

// ═══ Init ═══

setupWeekdayButtons();
setupFontSliders();
loadItems();
loadLocation();
loadFonts();
