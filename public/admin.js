const API = '/api';

const WEEKDAY_KEYS = ['weekday.sun', 'weekday.mon', 'weekday.tue', 'weekday.wed', 'weekday.thu', 'weekday.fri', 'weekday.sat'];
const CATEGORY_KEYS = {
  medication: 'category.medication',
  supplement: 'category.supplement',
  reminder: 'category.reminder',
};

// ═══ Items List ═══

async function loadItems() {
  const res = await fetch(`${API}/items`);
  const items = await res.json();
  renderItems(items);
}

// Cache of the latest items list, indexed by id, for quick lookups in popovers
// and inline editors without re-fetching.
let itemsById = {};

function weekdaysSummary(weekdays) {
  if (weekdays.length === 7) return t('admin.everyWeekday');
  if (weekdays.length === 0) return '—';
  return weekdays.map(d => t(WEEKDAY_KEYS[d])).join(', ');
}

// "Day-long" semantics: an item counts as day-long if it has no periods
// selected OR if all three are selected. Users intuitively express "runs
// all day" by ticking every box; we treat that the same as the wildcard.
function isDayLong(periods) {
  return !periods || periods.length === 0 || periods.length >= 3;
}

function periodsSummary(periods) {
  if (isDayLong(periods)) return t('admin.dayLong');
  const order = ['morning', 'afternoon', 'night'];
  return order
    .filter(p => periods.includes(p))
    .map(p => t('period.' + p))
    .join(', ');
}

function buildItemCard(item) {
  const weekdays = JSON.parse(item.weekdays || '[0,1,2,3,4,5,6]');
  let periods = [];
  try { periods = JSON.parse(item.periods || '[]'); } catch {}

  const countInfo = item.total_count ? `${item.completed_count}/${item.total_count}` : '';
  const catLabel = t(CATEGORY_KEYS[item.category] || '') || item.category;

  const statusIcons = [];
  if (item.alert_penultimate) {
    statusIcons.push(`<span class="status-icon" title="${escapeHtml(t('admin.alertPenultimateBadge'))}: ${escapeHtml(item.alert_penultimate)}"><span class="si-emoji">⚠️</span><span class="si-label">${escapeHtml(t('admin.alertPenultimateShort'))}</span></span>`);
  }
  if (item.alert_last) {
    statusIcons.push(`<span class="status-icon" title="${escapeHtml(t('admin.alertLastBadge'))}: ${escapeHtml(item.alert_last)}"><span class="si-emoji">🚨</span><span class="si-label">${escapeHtml(t('admin.alertLastShort'))}</span></span>`);
  }
  if (item.followup_title) {
    statusIcons.push(`<span class="status-icon" title="${escapeHtml(t('admin.followUpBadge'))}: ${escapeHtml(item.followup_title)}"><span class="si-emoji">↻</span><span class="si-label">${escapeHtml(t('admin.followUpShort'))}</span></span>`);
  }

  const card = document.createElement('div');
  card.className = `item-card${item.active ? '' : ' inactive'}`;
  card.dataset.id = item.id;
  card.innerHTML = `
    <span class="item-icon item-icon-edit" data-action="edit-icon" title="${escapeHtml(t('admin.clickToEdit'))}">${escapeHtml(item.icon)}</span>
    <div class="item-info">
      <div class="item-title item-title-edit" data-action="edit-title" title="${escapeHtml(t('admin.clickToEdit'))}">${escapeHtml(item.title)}</div>
      <div class="item-meta">
        <span class="badge ${escapeHtml(item.category)}">${escapeHtml(catLabel)}</span>
        <span class="meta-pill weekdays-pill" data-action="edit-weekdays" title="${escapeHtml(t('admin.clickToEdit'))}">${escapeHtml(weekdaysSummary(weekdays))}</span>
        <span class="meta-pill periods-pill" data-action="edit-periods" title="${escapeHtml(t('admin.clickToEdit'))}">${escapeHtml(periodsSummary(periods))}</span>
        ${countInfo ? `<span class="count-badge">${countInfo}</span>` : ''}
        ${statusIcons.join('')}
        ${!item.active ? `<em style="color:var(--accent-danger)">${escapeHtml(t('admin.deactivated'))}</em>` : ''}
      </div>
    </div>
    <div class="item-actions">
      <button class="btn btn-sm btn-secondary" data-action="open-modal">${escapeHtml(t('common.edit'))}</button>
      ${item.active
        ? `<button class="btn btn-sm btn-danger" data-action="deactivate">${escapeHtml(t('common.deactivate'))}</button>`
        : `<button class="btn btn-sm btn-secondary" data-action="reactivate">${escapeHtml(t('common.reactivate'))}</button>`
      }
      <button class="btn btn-sm btn-danger" data-delete-id="${item.id}" data-delete-title="${escapeHtml(item.title)}">${escapeHtml(t('common.delete'))}</button>
    </div>
  `;
  return card;
}

function renderItems(items) {
  itemsById = {};
  for (const it of items) itemsById[it.id] = it;

  const container = document.getElementById('items-list');
  container.innerHTML = '';

  // Partition items into buckets. Day-long items (empty array OR all 3
  // periods selected) go to the dayLong bucket only; items with 1-2 periods
  // appear in each matching bucket.
  const buckets = { dayLong: [], morning: [], afternoon: [], night: [], inactive: [] };
  for (const item of items) {
    if (!item.active) { buckets.inactive.push(item); continue; }
    let periods = [];
    try { periods = JSON.parse(item.periods || '[]'); } catch {}
    if (!Array.isArray(periods)) periods = [];
    if (isDayLong(periods)) {
      buckets.dayLong.push(item);
    } else {
      for (const p of ['morning', 'afternoon', 'night']) {
        if (periods.includes(p)) buckets[p].push(item);
      }
    }
  }

  const sectionDefs = [
    { key: 'dayLong',   labelKey: 'admin.dayLong' },
    { key: 'morning',   labelKey: 'period.morning' },
    { key: 'afternoon', labelKey: 'period.afternoon' },
    { key: 'night',     labelKey: 'period.night' },
    { key: 'inactive',  labelKey: 'admin.inactiveItems' },
  ];

  for (const def of sectionDefs) {
    const list = buckets[def.key];
    if (list.length === 0) continue;
    const section = document.createElement('div');
    section.className = `period-group period-group-${def.key}`;
    section.innerHTML = `<h3 class="period-group-title">${escapeHtml(t(def.labelKey))} <span class="period-group-count">${list.length}</span></h3>`;
    for (const item of list) {
      section.appendChild(buildItemCard(item));
    }
    container.appendChild(section);
  }
}

// ═══ Protocols ═══

const PERIOD_ORDER_PROTOCOL = ['morning', 'afternoon', 'night'];

function addDaysLocal(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(getLocale(), {
      day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
    });
  } catch { return dateStr; }
}

function todayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}

function computePhaseWindows(startDate, durations, repeatIndefinitely) {
  // durations: number[]. Returns [{start, end, days}] with end=null on last if repeat.
  let cursor = startDate;
  return durations.map((dur, i) => {
    const isLast = i === durations.length - 1;
    const safeDur = Number(dur) > 0 ? Number(dur) : 1;
    const start = cursor;
    const end = (isLast && repeatIndefinitely) ? null : addDaysLocal(start, safeDur - 1);
    cursor = addDaysLocal(start, safeDur);
    return { start, end, days: safeDur };
  });
}

function currentPhaseIndex(startDate, durations, repeatIndefinitely, today) {
  const windows = computePhaseWindows(startDate, durations, repeatIndefinitely);
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    if (today < w.start) return { index: -1, state: 'upcoming', first: w.start };
    if (w.end === null) return { index: i, state: 'active' };
    if (today >= w.start && today <= w.end) return { index: i, state: 'active' };
  }
  const last = windows[windows.length - 1];
  return { index: -1, state: 'ended', endedOn: last ? last.end : null };
}

async function loadProtocols() {
  try {
    const res = await fetch(`${API}/protocols`);
    if (!res.ok) {
      document.getElementById('protocols-list').innerHTML = '';
      return;
    }
    const protocols = await res.json();
    renderProtocols(protocols);
  } catch {
    document.getElementById('protocols-list').innerHTML = '';
  }
}

function renderProtocols(protocols) {
  const container = document.getElementById('protocols-list');
  container.innerHTML = '';
  if (!protocols.length) return;

  const today = todayISO();

  for (const p of protocols) {
    const phases = (p.phases || []);
    const durations = phases.map(ph => ph.end_date
      ? (dayDiff(ph.start_date, ph.end_date) + 1)
      : 1);
    // If last phase has end_date null, we don't know its duration from DB alone;
    // but for the status we only need to know if today is >= last start_date.
    const status = phaseStatusForProtocol(p, phases, today);

    const card = document.createElement('div');
    card.className = `protocol-card${p.active ? '' : ' inactive'}`;
    card.dataset.id = p.id;
    card.innerHTML = `
      <div class="protocol-card-head">
        <div class="protocol-card-info">
          <div class="protocol-card-title">${escapeHtml(p.name)}</div>
          <div class="protocol-card-meta">
            <span>📅 ${escapeHtml(formatDate(p.start_date))}</span>
            <span>${escapeHtml(t('admin.protocolPhaseCount', { n: phases.length }))}</span>
            ${status.label ? `<span class="protocol-status ${status.kind}">${escapeHtml(status.label)}</span>` : ''}
          </div>
        </div>
        <div class="protocol-card-actions">
          <button class="btn btn-sm btn-secondary" data-action="edit-protocol">${escapeHtml(t('common.edit'))}</button>
          <button class="btn btn-sm btn-danger" data-action="delete-protocol">${escapeHtml(t('common.delete'))}</button>
        </div>
      </div>
    `;
    container.appendChild(card);
  }
}

function dayDiff(startStr, endStr) {
  const [ys, ms, ds] = startStr.split('-').map(Number);
  const [ye, me, de] = endStr.split('-').map(Number);
  const s = Date.UTC(ys, ms - 1, ds);
  const e = Date.UTC(ye, me - 1, de);
  return Math.round((e - s) / 86400000);
}

function phaseStatusForProtocol(protocol, phases, today) {
  if (!phases.length) return { kind: 'ended', label: '' };
  const first = phases[0];
  const last = phases[phases.length - 1];

  if (today < first.start_date) {
    return { kind: 'upcoming', label: t('admin.protocolNotStarted', { date: formatDate(first.start_date) }) };
  }

  // Find active phase
  for (let i = 0; i < phases.length; i++) {
    const ph = phases[i];
    const inWindow = ph.end_date
      ? (today >= ph.start_date && today <= ph.end_date)
      : (today >= ph.start_date);
    if (inWindow) {
      return { kind: 'active', label: t('admin.currentPhase', { n: i + 1 }) };
    }
  }

  return { kind: 'ended', label: t('admin.protocolEnded', { date: formatDate(last.end_date || last.start_date) }) };
}

// ═══ Protocol Modal ═══

function openProtocolModal(id) {
  document.getElementById('protocol-form').reset();
  document.getElementById('protocol-id').value = '';
  document.getElementById('phases-container').innerHTML = '';
  document.getElementById('protocol-modal-title').textContent = id
    ? t('admin.editProtocol')
    : t('admin.newProtocol');

  if (id) {
    fetch(`${API}/protocols/${id}`).then(r => r.ok ? r.json() : null).then(p => {
      if (!p) return;
      document.getElementById('protocol-id').value = p.id;
      document.getElementById('protocol-name').value = p.name;
      document.getElementById('protocol-start-date').value = p.start_date;
      document.getElementById('protocol-repeat-indefinitely').checked = !!p.repeat_indefinitely;
      const phases = p.phases || [];
      for (const phase of phases) {
        const dur = phase.end_date
          ? (dayDiff(phase.start_date, phase.end_date) + 1)
          : 1;
        addPhaseToForm({ ...phase, duration_days: dur });
      }
      if (!phases.length) addPhaseToForm();
      renderPhaseTimeline();
    });
  } else {
    document.getElementById('protocol-start-date').value = todayISO();
    document.getElementById('protocol-repeat-indefinitely').checked = false;
    addPhaseToForm();
    renderPhaseTimeline();
  }

  document.getElementById('protocol-modal').classList.add('active');
}

function closeProtocolModal() {
  document.getElementById('protocol-modal').classList.remove('active');
}

document.getElementById('protocol-modal').addEventListener('click', (e) => {
  if (e.target.id === 'protocol-modal') closeProtocolModal();
});

function buildPhaseCard(phase = {}) {
  const card = document.createElement('div');
  card.className = 'phase-card';

  let periods = [];
  try { periods = JSON.parse(phase.periods || '[]'); } catch {}
  if (!Array.isArray(periods)) periods = [];

  const cat = phase.category || 'medication';

  card.innerHTML = `
    <div class="phase-header">
      <span class="phase-number"></span>
      <label class="phase-duration-group">
        <span class="phase-duration-label">${escapeHtml(t('admin.phaseDuration'))}</span>
        <input type="number" class="phase-duration" min="1" max="3650" value="${phase.duration_days != null ? phase.duration_days : ''}" required>
        <span class="phase-duration-suffix">${escapeHtml(t('admin.daysUnit'))}</span>
      </label>
      <button type="button" class="phase-remove" data-action="remove-phase" title="${escapeHtml(t('admin.removePhase'))}">✕</button>
    </div>
    <div class="phase-body">
      <div class="phase-row">
        <input class="phase-icon icon-input-trigger" maxlength="4" value="${escapeHtml(phase.icon || '💊')}" readonly>
        <input class="phase-title" value="${escapeHtml(phase.title || '')}" placeholder="${escapeHtml(t('admin.phaseTitlePlaceholder'))}" maxlength="200" required>
        <select class="phase-category">
          <option value="medication" ${cat === 'medication' ? 'selected' : ''}>${escapeHtml(t('category.medication'))}</option>
          <option value="supplement" ${cat === 'supplement' ? 'selected' : ''}>${escapeHtml(t('category.supplement'))}</option>
          <option value="reminder" ${cat === 'reminder' ? 'selected' : ''}>${escapeHtml(t('category.reminder'))}</option>
        </select>
      </div>
      <div class="period-selector phase-periods">
        <button type="button" class="period-btn${periods.includes('morning') ? ' active' : ''}" data-period="morning">${escapeHtml(t('period.morning'))}</button>
        <button type="button" class="period-btn${periods.includes('afternoon') ? ' active' : ''}" data-period="afternoon">${escapeHtml(t('period.afternoon'))}</button>
        <button type="button" class="period-btn${periods.includes('night') ? ' active' : ''}" data-period="night">${escapeHtml(t('period.night'))}</button>
      </div>
    </div>
  `;

  // Wire icon picker on the icon input
  const iconInput = card.querySelector('.phase-icon');
  iconInput.style.cursor = 'pointer';
  iconInput.addEventListener('click', (e) => {
    e.stopPropagation();
    if (typeof openPicker === 'function') openPicker(iconInput);
  });
  // Listen for picker output to keep the field consistent
  iconInput.addEventListener('input', () => renderPhaseTimeline());

  // Period buttons (local toggle state)
  card.querySelectorAll('.phase-periods .period-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      btn.classList.toggle('active');
    });
  });

  // Trigger timeline refresh on duration change
  card.querySelector('.phase-duration').addEventListener('input', () => renderPhaseTimeline());

  return card;
}

function snapshotPhaseCard(card) {
  // Serialize the current DOM state of a phase card into the shape expected
  // by buildPhaseCard. Used so "+ Adicionar fase" pre-fills from the last
  // phase — escalation protocols typically vary only the title between steps.
  const activePeriods = Array.from(card.querySelectorAll('.phase-periods .period-btn.active'))
    .map(b => b.dataset.period);
  return {
    duration_days: Number(card.querySelector('.phase-duration').value) || '',
    title: card.querySelector('.phase-title').value,
    icon: card.querySelector('.phase-icon').value,
    category: card.querySelector('.phase-category').value,
    periods: JSON.stringify(activePeriods),
  };
}

function addPhaseToForm(phase) {
  const container = document.getElementById('phases-container');
  // If caller didn't pass a phase and there's already one on the form, clone
  // its values so the user doesn't have to re-pick icon/category/periods.
  if (phase === undefined) {
    const existing = container.querySelectorAll('.phase-card');
    if (existing.length > 0) {
      phase = snapshotPhaseCard(existing[existing.length - 1]);
    }
  }
  container.appendChild(buildPhaseCard(phase || {}));
  refreshPhaseNumbers();
  renderPhaseTimeline();
}

function refreshPhaseNumbers() {
  const cards = document.querySelectorAll('#phases-container .phase-card');
  cards.forEach((card, i) => {
    const numEl = card.querySelector('.phase-number');
    if (numEl) numEl.textContent = t('admin.phaseNumber', { n: i + 1 });
    // Only allow remove if there are 2+ phases
    const rm = card.querySelector('.phase-remove');
    if (rm) rm.style.visibility = cards.length > 1 ? '' : 'hidden';
  });
}

// Event delegation for remove buttons
document.getElementById('phases-container').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="remove-phase"]');
  if (!btn) return;
  const card = btn.closest('.phase-card');
  if (card) {
    card.remove();
    refreshPhaseNumbers();
    renderPhaseTimeline();
  }
});

function collectPhasesFromForm() {
  const cards = document.querySelectorAll('#phases-container .phase-card');
  return Array.from(cards).map(card => {
    const periods = Array.from(card.querySelectorAll('.phase-periods .period-btn.active'))
      .map(b => b.dataset.period);
    periods.sort((a, b) => PERIOD_ORDER_PROTOCOL.indexOf(a) - PERIOD_ORDER_PROTOCOL.indexOf(b));
    return {
      duration_days: Number(card.querySelector('.phase-duration').value) || 1,
      title: card.querySelector('.phase-title').value.trim(),
      icon: card.querySelector('.phase-icon').value.trim() || '💊',
      category: card.querySelector('.phase-category').value,
      periods: JSON.stringify(periods),
      weekdays: '[0,1,2,3,4,5,6]',
    };
  });
}

function renderPhaseTimeline() {
  const container = document.getElementById('phases-timeline');
  if (!container) return;
  const startDate = document.getElementById('protocol-start-date').value;
  const repeatIndef = document.getElementById('protocol-repeat-indefinitely').checked;
  if (!startDate) { container.innerHTML = ''; return; }

  const cards = document.querySelectorAll('#phases-container .phase-card');
  if (!cards.length) { container.innerHTML = ''; return; }

  const durations = Array.from(cards).map(c => Number(c.querySelector('.phase-duration').value) || 1);
  const windows = computePhaseWindows(startDate, durations, repeatIndef);
  const today = todayISO();
  const status = currentPhaseIndex(startDate, durations, repeatIndef, today);

  container.innerHTML = windows.map((w, i) => {
    const labelText = t('admin.phaseNumber', { n: i + 1 });
    const rangeText = w.end === null
      ? t('admin.timelineForever', { start: formatDate(w.start) })
      : t('admin.timelineRange', { start: formatDate(w.start), end: formatDate(w.end), days: w.days });
    const isCurrent = (status.state === 'active' && status.index === i);
    return `<div class="phase-timeline-row">
      <span class="${isCurrent ? 'tl-current' : 'tl-label'}">${escapeHtml(labelText)}${isCurrent ? ' ●' : ''}</span>
      <span>${escapeHtml(rangeText)}</span>
    </div>`;
  }).join('');
}

// Live recalc on identity changes
document.getElementById('protocol-start-date').addEventListener('input', renderPhaseTimeline);
document.getElementById('protocol-repeat-indefinitely').addEventListener('change', renderPhaseTimeline);

// Submit
document.getElementById('protocol-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const id = document.getElementById('protocol-id').value;
  const payload = {
    name: document.getElementById('protocol-name').value.trim(),
    start_date: document.getElementById('protocol-start-date').value,
    repeat_indefinitely: document.getElementById('protocol-repeat-indefinitely').checked,
    phases: collectPhasesFromForm(),
  };

  if (!payload.phases.length) {
    showToast(t('admin.phases') + ' ≥ 1', 'err');
    return;
  }

  const url = id ? `${API}/protocols/${id}` : `${API}/protocols`;
  const method = id ? 'PUT' : 'POST';

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    showToast(err.error || 'Erro', 'err');
    return;
  }

  showToast(t('admin.protocolSaved'));
  closeProtocolModal();
  loadProtocols();
  loadItems();
});

// Protocol list event delegation
document.getElementById('protocols-list').addEventListener('click', async (e) => {
  const card = e.target.closest('.protocol-card');
  if (!card) return;
  const id = Number(card.dataset.id);
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;

  if (actionEl.dataset.action === 'edit-protocol') {
    openProtocolModal(id);
  } else if (actionEl.dataset.action === 'delete-protocol') {
    const title = card.querySelector('.protocol-card-title')?.textContent || '';
    document.getElementById('confirm-message').textContent =
      t('admin.deleteProtocolConfirm', { name: title });
    document.getElementById('confirm-dialog').classList.add('active');
    pendingAction = async () => {
      await fetch(`${API}/protocols/${id}`, { method: 'DELETE' });
      loadProtocols();
      loadItems();
    };
  }
});

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
let currentEditPeriods = []; // [] = day-long (visible in every period)

const PERIOD_ORDER = ['morning', 'afternoon', 'night'];

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

function setupPeriodButtons() {
  document.querySelectorAll('#edit-periods .period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const period = btn.dataset.period;
      const idx = currentEditPeriods.indexOf(period);
      if (idx >= 0) {
        currentEditPeriods.splice(idx, 1);
        btn.classList.remove('active');
      } else {
        currentEditPeriods.push(period);
        currentEditPeriods.sort((a, b) => PERIOD_ORDER.indexOf(a) - PERIOD_ORDER.indexOf(b));
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

  // Periods
  try {
    currentEditPeriods = JSON.parse(item.periods || '[]');
  } catch {
    currentEditPeriods = [];
  }
  if (!Array.isArray(currentEditPeriods)) currentEditPeriods = [];
  document.querySelectorAll('#edit-periods .period-btn').forEach(btn => {
    btn.classList.toggle('active', currentEditPeriods.includes(btn.dataset.period));
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
    periods: JSON.stringify(currentEditPeriods),
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
    t('admin.confirmDelete', { title });
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

function applyLocationFromSettings(settings) {
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
      container.innerHTML = `<div class="search-result"><em style="color:var(--text-muted)">${escapeHtml(t('admin.noResults'))}</em></div>`;
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
    slider.addEventListener('input', () => {
      const valueEl = document.getElementById('fv-' + slider.id.replace('fs-', ''));
      if (valueEl) valueEl.textContent = slider.value;
    });
  });
}

function applyFontsFromSettings(settings) {
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
  btn.textContent = t('admin.saved');
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
  btn.textContent = t('admin.restored');
  setTimeout(() => { btn.textContent = orig; }, 1500);
}

// ═══ Period Settings ═══

const PERIOD_SETTINGS_DEFAULTS = {
  period_morning_start: '05:00',
  period_afternoon_start: '12:00',
  period_night_start: '18:00',
  period_display_mode: 'words',
};

function applyPeriodSettings(settings) {
  // Always write — fall back to defaults if a key is absent. Without the
  // fallback, a revert-after-error leaves the input stuck on the bad value
  // when no value had been stored yet.
  const get = (k) => settings[k] || PERIOD_SETTINGS_DEFAULTS[k];
  document.getElementById('setting-morning-start').value = get('period_morning_start');
  document.getElementById('setting-afternoon-start').value = get('period_afternoon_start');
  document.getElementById('setting-night-start').value = get('period_night_start');
  document.getElementById('setting-display-mode').value = get('period_display_mode');
}

function showSaveStatus(el, text, kind) {
  if (!el) return;
  el.textContent = text;
  el.className = 'save-status ' + kind;
  el.hidden = false;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.hidden = true; }, 2200);
}

async function autoSavePeriodSetting(key, value, statusEl) {
  try {
    const res = await fetch(`${API}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: value }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showSaveStatus(statusEl, '✗ ' + (err.error || 'Erro'), 'err');
      // Revert: re-fetch settings to restore last good value in the DOM
      try {
        const cur = await (await fetch(`${API}/settings`)).json();
        applyPeriodSettings(cur);
      } catch {}
      return false;
    }
    showSaveStatus(statusEl, '✓ ' + t('admin.saved'), 'ok');
    return true;
  } catch {
    showSaveStatus(statusEl, '✗ Erro', 'err');
    return false;
  }
}

function setupPeriodSettingsAutoSave() {
  const status = document.getElementById('period-save-status');
  const bind = (id, key) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => autoSavePeriodSetting(key, el.value, status));
  };
  bind('setting-morning-start', 'period_morning_start');
  bind('setting-afternoon-start', 'period_afternoon_start');
  bind('setting-night-start', 'period_night_start');
  bind('setting-display-mode', 'period_display_mode');
}

// ═══ Language Selector ═══

function setupLanguageSelector(settings) {
  const select = document.getElementById('language-select');
  if (settings && settings.language) {
    select.value = settings.language;
  } else {
    select.value = getLang();
  }

  select.addEventListener('change', async () => {
    const lang = select.value;
    await fetch(`${API}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: lang }),
    });
    await setLanguage(lang);
    loadItems();
    loadProtocols();
  });
}

// ═══ Unified Settings Loader ═══

async function loadSettings() {
  try {
    const res = await fetch(`${API}/settings`);
    const settings = await res.json();
    await initI18n(settings);
    applyLocationFromSettings(settings);
    applyFontsFromSettings(settings);
    applyPeriodSettings(settings);
    setupLanguageSelector(settings);
  } catch (err) {
    await initI18n();
  }
}

// ═══ Init ═══

// ═══ Toast ═══

let toastTimer = null;
function showToast(message, kind = 'ok') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${kind}`;
  toast.textContent = (kind === 'ok' ? '✓ ' : '✗ ') + message;
  container.appendChild(toast);
  // Animate in on next frame
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 1800);
}

// ═══ Inline Edit Helpers ═══

async function patchItem(id, patch, opts = {}) {
  const res = await fetch(`${API}/items/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error('PATCH failed', err);
    if (opts.toast !== false) showToast(err.error || 'Erro', 'err');
    return null;
  }
  const data = await res.json();
  if (opts.toast !== false) showToast(t('admin.toastSaved'));
  return data;
}

function startInlineTitleEdit(card) {
  const titleEl = card.querySelector('.item-title-edit');
  if (!titleEl || titleEl.querySelector('input')) return;
  const id = Number(card.dataset.id);
  const original = itemsById[id]?.title || titleEl.textContent;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = original;
  input.className = 'inline-title-input';
  input.maxLength = 200;
  titleEl.innerHTML = '';
  titleEl.appendChild(input);
  input.focus();
  input.select();

  let done = false;
  const finish = async (commit) => {
    if (done) return;
    done = true;
    const newVal = input.value.trim();
    if (commit && newVal && newVal !== original) {
      const updated = await patchItem(id, { title: newVal });
      if (updated) itemsById[id] = updated;
      titleEl.textContent = newVal;
    } else {
      titleEl.textContent = original;
    }
  };
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
}

function startInlineIconEdit(card) {
  const iconEl = card.querySelector('.item-icon-edit');
  if (!iconEl) return;
  const id = Number(card.dataset.id);

  // Reuse the existing icon-picker by giving it a hidden input that fires
  // an `input` event when the user picks an emoji.
  let proxy = document.getElementById('inline-icon-proxy');
  if (!proxy) {
    proxy = document.createElement('input');
    proxy.id = 'inline-icon-proxy';
    proxy.type = 'text';
    proxy.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0';
    document.body.appendChild(proxy);
  }
  proxy.value = itemsById[id]?.icon || '';
  // Position the picker visually below the clicked icon.
  // openPicker() reads getBoundingClientRect() — temporarily make the proxy
  // overlap the icon so the picker pops up next to it.
  const rect = iconEl.getBoundingClientRect();
  proxy.style.left = rect.left + 'px';
  proxy.style.top = rect.top + 'px';
  proxy.style.width = rect.width + 'px';
  proxy.style.height = rect.height + 'px';
  proxy.style.opacity = '0';

  // Single-shot listener: when the picker writes a new value, PUT it.
  const handler = async () => {
    proxy.removeEventListener('input', handler);
    const newIcon = proxy.value.trim();
    if (newIcon && newIcon !== itemsById[id]?.icon) {
      const updated = await patchItem(id, { icon: newIcon });
      if (updated) {
        itemsById[id] = updated;
        iconEl.textContent = newIcon;
      }
    }
  };
  proxy.addEventListener('input', handler);

  if (typeof openPicker === 'function') {
    openPicker(proxy);
  }
}

// ═══ Popovers (weekdays + periods) ═══

let activePopover = null;

function closePopover() {
  if (activePopover) {
    activePopover.remove();
    activePopover = null;
  }
}

function openWeekdaysPopover(card, anchorEl) {
  closePopover();
  const id = Number(card.dataset.id);
  const item = itemsById[id];
  if (!item) return;
  const initial = item.weekdays || '[0,1,2,3,4,5,6]';
  let current = JSON.parse(initial);

  const pop = document.createElement('div');
  pop.className = 'inline-popover';
  pop.innerHTML = `
    <div class="popover-title">${escapeHtml(t('admin.weekdays'))}</div>
    <div class="weekday-selector">
      ${[0,1,2,3,4,5,6].map(d => `
        <button type="button" class="weekday-btn${current.includes(d) ? ' active' : ''}" data-day="${d}">${escapeHtml(t(WEEKDAY_KEYS[d]))}</button>
      `).join('')}
    </div>
  `;
  positionPopover(pop, anchorEl);
  document.body.appendChild(pop);
  activePopover = pop;

  pop.addEventListener('click', (e) => {
    const btn = e.target.closest('.weekday-btn');
    if (!btn) return;
    e.stopPropagation();
    const d = Number(btn.dataset.day);
    const i = current.indexOf(d);
    if (i >= 0) { current.splice(i, 1); btn.classList.remove('active'); }
    else { current.push(d); current.sort(); btn.classList.add('active'); }
  });

  // Save on close (only if the user actually changed something)
  pop._onClose = async () => {
    const next = JSON.stringify(current);
    if (next === initial) return; // no-op: skip PUT + toast
    const updated = await patchItem(id, { weekdays: next });
    if (updated) {
      itemsById[id] = updated;
      const pill = card.querySelector('.weekdays-pill');
      if (pill) pill.textContent = weekdaysSummary(current);
    }
  };
}

function openPeriodsPopover(card, anchorEl) {
  closePopover();
  const id = Number(card.dataset.id);
  const item = itemsById[id];
  if (!item) return;
  const initial = item.periods || '[]';
  let current = [];
  try { current = JSON.parse(initial); } catch {}

  const order = ['morning', 'afternoon', 'night'];
  const pop = document.createElement('div');
  pop.className = 'inline-popover';
  pop.innerHTML = `
    <div class="popover-title">${escapeHtml(t('admin.periods'))}</div>
    <div class="period-selector">
      ${order.map(p => `
        <button type="button" class="period-btn${current.includes(p) ? ' active' : ''}" data-period="${p}">${escapeHtml(t('period.' + p))}</button>
      `).join('')}
    </div>
    <small class="period-help">${escapeHtml(t('admin.periodsHelp'))}</small>
  `;
  positionPopover(pop, anchorEl);
  document.body.appendChild(pop);
  activePopover = pop;

  pop.addEventListener('click', (e) => {
    const btn = e.target.closest('.period-btn');
    if (!btn) return;
    e.stopPropagation();
    const p = btn.dataset.period;
    const i = current.indexOf(p);
    if (i >= 0) { current.splice(i, 1); btn.classList.remove('active'); }
    else {
      current.push(p);
      current.sort((a, b) => order.indexOf(a) - order.indexOf(b));
      btn.classList.add('active');
    }
  });

  pop._onClose = async () => {
    const next = JSON.stringify(current);
    if (next === initial) return; // no-op: skip PUT + toast
    const updated = await patchItem(id, { periods: next });
    if (updated) {
      itemsById[id] = updated;
      // Periods change affects grouping → re-render the whole list
      loadItems();
    }
  };
}

function positionPopover(pop, anchorEl) {
  const r = anchorEl.getBoundingClientRect();
  pop.style.position = 'absolute';
  pop.style.top = (r.bottom + window.scrollY + 6) + 'px';
  pop.style.left = (r.left + window.scrollX) + 'px';
  pop.style.zIndex = '300';
}

// Close popover when clicking outside it (and trigger save)
document.addEventListener('click', (e) => {
  if (!activePopover) return;
  if (activePopover.contains(e.target)) return;
  // Don't close if clicking the same trigger (it'll re-open below)
  if (e.target.closest('[data-action="edit-weekdays"]') || e.target.closest('[data-action="edit-periods"]')) return;
  const onClose = activePopover._onClose;
  closePopover();
  if (typeof onClose === 'function') onClose();
});

// ═══ Master event delegation for items list ═══

document.getElementById('items-list').addEventListener('click', (e) => {
  // Delete (must come first since it has its own data attributes)
  const delBtn = e.target.closest('[data-delete-id]');
  if (delBtn) {
    confirmDelete(Number(delBtn.dataset.deleteId), delBtn.dataset.deleteTitle);
    return;
  }

  const card = e.target.closest('.item-card');
  if (!card) return;
  const id = Number(card.dataset.id);
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;
  const action = actionEl.dataset.action;

  switch (action) {
    case 'edit-title':
      e.stopPropagation();
      startInlineTitleEdit(card);
      break;
    case 'edit-icon':
      e.stopPropagation();
      startInlineIconEdit(card);
      break;
    case 'edit-weekdays': {
      e.stopPropagation();
      const wasOpen = activePopover && activePopover.dataset.kind === 'weekdays' && activePopover.dataset.cardId === String(id);
      const onClose = activePopover?._onClose;
      closePopover();
      if (onClose) onClose();
      if (!wasOpen) {
        openWeekdaysPopover(card, actionEl);
        if (activePopover) {
          activePopover.dataset.kind = 'weekdays';
          activePopover.dataset.cardId = String(id);
        }
      }
      break;
    }
    case 'edit-periods': {
      e.stopPropagation();
      const wasOpen = activePopover && activePopover.dataset.kind === 'periods' && activePopover.dataset.cardId === String(id);
      const onClose = activePopover?._onClose;
      closePopover();
      if (onClose) onClose();
      if (!wasOpen) {
        openPeriodsPopover(card, actionEl);
        if (activePopover) {
          activePopover.dataset.kind = 'periods';
          activePopover.dataset.cardId = String(id);
        }
      }
      break;
    }
    case 'open-modal':
      openEditModal(id);
      break;
    case 'deactivate':
      deactivateItem(id);
      break;
    case 'reactivate':
      reactivateItem(id);
      break;
  }
});

setupWeekdayButtons();
setupPeriodButtons();
setupFontSliders();
setupPeriodSettingsAutoSave();

(async () => {
  await loadSettings();
  loadItems();
  loadProtocols();
})();
