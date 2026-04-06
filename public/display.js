const API_BASE = '/api';
const POLL_INTERVAL = 60 * 1000;         // 1 min — tasks
const WEATHER_INTERVAL = 5 * 60 * 1000;  // 5 min — weather
const CELEBRATION_DURATION = 3000;        // 3s
const IDLE_TIMEOUT = 5 * 60 * 1000;      // 5 min — auto-reset to today

let tasks = [];
let wasAllDone = false;
let currentDate = todayStr();
let currentPeriod = 'all'; // 'all' | 'morning' | 'afternoon' | 'night'
let idleTimer = null;

// ═══ Date Navigation ═══

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function navigateDate(offset) {
  const d = new Date(currentDate + 'T12:00:00');
  d.setDate(d.getDate() + offset);
  currentDate = d.toISOString().split('T')[0];
  updateDateDisplay();
  updateTodayButton();
  fetchTasks();
}

function goToday() {
  currentDate = todayStr();
  updateDateDisplay();
  updateTodayButton();
  fetchTasks();
}

function updateTodayButton() {
  const btn = document.getElementById('date-today');
  btn.style.display = currentDate === todayStr() ? 'none' : '';
}

function updateDateDisplay() {
  const d = new Date(currentDate + 'T12:00:00');
  const locale = getLocale();
  const weekday = d.toLocaleDateString(locale, { weekday: 'long' });
  const day = d.getDate();
  const month = d.toLocaleDateString(locale, { month: 'long' });
  const fmt = getDateFormat();
  document.getElementById('date-display').textContent = fmt
    .replace('{weekday}', weekday)
    .replace('{day}', day)
    .replace('{month}', month);
}

// ═══ Idle Auto-Reset ═══

function resetIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (currentDate !== todayStr()) {
      goToday();
    }
    if (currentPeriod !== 'all') {
      setPeriod('all');
    }
  }, IDLE_TIMEOUT);
}

// ═══ Period Filter ═══

function getVisibleTasks() {
  if (currentPeriod === 'all') return tasks;
  return tasks.filter(task => {
    let periods;
    try {
      periods = JSON.parse(task.periods || '[]');
    } catch {
      periods = [];
    }
    // Empty array = day-long: visible in every period
    return periods.length === 0 || periods.includes(currentPeriod);
  });
}

function setPeriod(period) {
  currentPeriod = period;
  document.querySelectorAll('.period-nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.period === period);
  });
  renderTasks();
}

// ═══ Clock, Date & Greeting ═══

function updateClock() {
  const now = new Date();
  document.getElementById('clock').textContent = now.toLocaleTimeString(getLocale(), {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function updateGreeting() {
  const hour = new Date().getHours();
  let key;
  if (hour < 12) key = 'greeting.morning';
  else if (hour < 18) key = 'greeting.afternoon';
  else key = 'greeting.evening';
  document.getElementById('greeting').textContent = t(key);
}

function updateDate() {
  // If viewing today, update from system clock; otherwise keep navigated date
  if (currentDate === todayStr()) {
    updateDateDisplay();
  }
}

// ═══ Weather ═══

async function fetchWeather() {
  const el = document.getElementById('weather');
  try {
    const res = await fetch(`${API_BASE}/weather`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    el.innerHTML = `
      <div class="weather-content">
        <span class="weather-icon">${escapeHtml(data.icon)}</span>
        <div class="weather-info">
          <span class="weather-temp">${Math.round(data.temperature)}°C</span>
          <span class="weather-desc">${escapeHtml(data.description)}</span>
        </div>
      </div>
      ${data.cityName ? `<p class="weather-city">${escapeHtml(data.cityName)}</p>` : ''}
      ${data.hint ? `<p class="weather-hint">${escapeHtml(data.hint)}</p>` : ''}
    `;
  } catch (err) {
    console.error('Weather fetch failed:', err);
    el.innerHTML = `<div class="weather-loading">${escapeHtml(t('display.noData'))}</div>`;
  }
}

// ═══ Tasks ═══

async function fetchTasks() {
  try {
    const res = await fetch(`${API_BASE}/tasks?date=${currentDate}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    tasks = await res.json();
    renderTasks();
  } catch (err) {
    console.error('Failed to fetch tasks:', err);
  }
}

function renderTasks() {
  const visible = getVisibleTasks();
  const categories = ['medication', 'supplement', 'reminder'];

  for (const cat of categories) {
    const col = document.getElementById(`col-${cat}`);
    const container = col.querySelector('.column-tasks');
    const catTasks = visible.filter(t => t.category === cat);

    // Hide empty columns
    col.dataset.empty = catTasks.length === 0 ? 'true' : 'false';

    container.innerHTML = '';
    for (const task of catTasks) {
      container.appendChild(createTaskElement(task));
    }
  }

  // Show global empty state when the active period has zero visible tasks
  const emptyEl = document.getElementById('period-empty');
  if (emptyEl) {
    emptyEl.hidden = visible.length > 0;
  }

  updateProgress();
}

function createTaskElement(task) {
  const el = document.createElement('div');
  const hasAlert = task.alert && !task.completed;
  el.className = `task ${task.category}${task.completed ? ' completed' : ''}${hasAlert ? ' has-alert' : ''}`;
  el.dataset.id = task.id;

  const alertHTML = hasAlert
    ? `<div class="task-alert ${escapeHtml(task.alert.type)}">${escapeHtml(task.alert.message)}</div>`
    : '';

  const countHTML = task.total_count
    ? `<span class="task-count">${task.completed_count}/${task.total_count}</span>`
    : '';

  el.innerHTML = `
    <span class="task-icon">${escapeHtml(task.icon)}</span>
    <div class="task-body">
      <span class="task-title">${escapeHtml(task.title)}</span>
      ${alertHTML}
    </div>
    <div class="task-check-group">
      <span class="task-check"></span>
      ${countHTML}
    </div>
  `;

  el.addEventListener('click', () => toggleTask(task.id, el));
  return el;
}

// ═══ Toggle ═══

async function toggleTask(id, el) {
  const wasCompleted = el.classList.contains('completed');
  el.classList.toggle('completed');

  if (!wasCompleted) {
    el.classList.add('just-completed');
    setTimeout(() => el.classList.remove('just-completed'), 700);
  }

  try {
    const res = await fetch(`${API_BASE}/tasks/${id}/toggle`, { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const updated = await res.json();

    const idx = tasks.findIndex(t => t.id === id);
    if (idx !== -1) tasks[idx] = updated;
    updateProgress();
  } catch (err) {
    console.error('Failed to toggle task:', err);
    el.classList.toggle('completed');
  }
}

// ═══ Progress ═══

function updateProgress() {
  const visible = getVisibleTasks();
  const total = visible.length;
  const done = visible.filter(t => t.completed).length;
  const pct = total > 0 ? (done / total) * 100 : 0;

  const fill = document.getElementById('progress-fill');
  const text = document.getElementById('progress-text');

  fill.style.width = `${pct}%`;

  if (done === total && total > 0) {
    fill.classList.add('complete');
    text.textContent = t('display.allDone');
    text.classList.add('all-done');

    // Celebration — only trigger once
    if (!wasAllDone) {
      wasAllDone = true;
      showCelebration();
    }
  } else {
    fill.classList.remove('complete');
    text.textContent = t('display.progress', { done, total });
    text.classList.remove('all-done');
    wasAllDone = false;
  }
}

function showCelebration() {
  const el = document.getElementById('celebration');
  spawnConfetti();
  el.classList.add('active');
  setTimeout(() => {
    el.classList.remove('active');
    document.getElementById('confetti').innerHTML = '';
  }, CELEBRATION_DURATION);
}

function spawnConfetti() {
  const container = document.getElementById('confetti');
  container.innerHTML = '';
  const colors = ['#f2736a', '#e8a84b', '#6b8fd4', '#5ec26a', '#f0ece4', '#d4a5ff'];

  for (let i = 0; i < 40; i++) {
    const particle = document.createElement('div');
    particle.className = 'confetti-particle';
    particle.style.left = Math.random() * 100 + '%';
    particle.style.top = -10 + 'px';
    particle.style.background = colors[Math.floor(Math.random() * colors.length)];
    particle.style.animationDelay = (Math.random() * 0.8) + 's';
    particle.style.animationDuration = (1.5 + Math.random() * 1.5) + 's';
    particle.style.width = (5 + Math.random() * 6) + 'px';
    particle.style.height = (5 + Math.random() * 6) + 'px';
    particle.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    container.appendChild(particle);
  }
}

// ═══ Font Settings ═══

const FONT_VAR_MAP = {
  font_clock: '--fs-clock',
  font_greeting: '--fs-greeting',
  font_date: '--fs-date',
  font_weather_temp: '--fs-weather-temp',
  font_task_title: '--fs-task-title',
  font_col_header: '--fs-col-header',
  font_task_icon: '--fs-task-icon',
  font_progress: '--fs-progress',
  font_task_count: '--fs-task-count',
};

function applyFontSettings(settings) {
  const root = document.documentElement;
  for (const [key, cssVar] of Object.entries(FONT_VAR_MAP)) {
    if (settings[key]) {
      root.style.setProperty(cssVar, settings[key] + 'rem');
    }
  }
}

// ═══ Unified Settings Loader ═══

async function loadSettings() {
  try {
    const res = await fetch(`${API_BASE}/settings`);
    if (!res.ok) return;
    const settings = await res.json();
    applyFontSettings(settings);
    await initI18n(settings);
  } catch (err) {
    // Silent fail — defaults apply
    await initI18n();
  }
}

// ═══ Init ═══

(async () => {
  await loadSettings();
  updateClock();
  updateGreeting();
  updateDateDisplay();
  updateTodayButton();
  fetchTasks();
  fetchWeather();
})();

// Date navigation
document.getElementById('date-prev').addEventListener('click', () => navigateDate(-1));
document.getElementById('date-next').addEventListener('click', () => navigateDate(1));
document.getElementById('date-today').addEventListener('click', goToday);

// Period filter
document.querySelectorAll('.period-nav-btn').forEach(btn => {
  btn.addEventListener('click', () => setPeriod(btn.dataset.period));
});

// Idle auto-reset
document.addEventListener('click', resetIdleTimer);
document.addEventListener('touchstart', resetIdleTimer);
resetIdleTimer();

setInterval(updateClock, 1000);
setInterval(updateGreeting, 60 * 1000);
setInterval(updateDate, 60 * 1000);
setInterval(fetchTasks, POLL_INTERVAL);
setInterval(fetchWeather, WEATHER_INTERVAL);
setInterval(loadSettings, POLL_INTERVAL); // Sync font & language changes
