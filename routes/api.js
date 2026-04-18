const { Router } = require('express');
const {
  getTasksForDate,
  toggleTask,
  getAllRoutineItems,
  createRoutineItem,
  updateRoutineItem,
  deactivateRoutineItem,
  deleteRoutineItemPermanently,
  getSetting,
  setSetting,
  getAllSettings,
  getProtocols,
  getProtocol,
  createProtocol,
  updateProtocol,
  deleteProtocol,
  convertItemToProtocol,
} = require('../db');
const { fetchWeather } = require('../weather');

const rateLimit = require('express-rate-limit');

const router = Router();

// Auth middleware for write operations (returns 401 JSON, not redirect)
function requireApiAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  res.status(401).json({ error: 'Authentication required' });
}

// ═══ Input Validation ═══

const VALID_CATEGORIES = ['medication', 'supplement', 'reminder'];
const VALID_PERIODS = ['morning', 'afternoon', 'night'];
const MAX_TITLE = 200;
const MAX_TEXT = 500;
const MAX_ICON = 10;

function validateItemData(data, isCreate) {
  const errors = [];

  if (isCreate && (!data.title || typeof data.title !== 'string')) {
    errors.push('title is required');
  }
  if (data.title && data.title.length > MAX_TITLE) {
    errors.push(`title max ${MAX_TITLE} chars`);
  }

  if (isCreate && !VALID_CATEGORIES.includes(data.category)) {
    errors.push(`category must be one of: ${VALID_CATEGORIES.join(', ')}`);
  }
  if (data.category && !VALID_CATEGORIES.includes(data.category)) {
    errors.push(`category must be one of: ${VALID_CATEGORIES.join(', ')}`);
  }

  if (data.icon && data.icon.length > MAX_ICON) {
    errors.push(`icon max ${MAX_ICON} chars`);
  }

  if (data.sort_order !== undefined && (!Number.isInteger(Number(data.sort_order)) || data.sort_order < -1000 || data.sort_order > 1000)) {
    errors.push('sort_order must be integer between -1000 and 1000');
  }

  if (data.weekdays) {
    try {
      const w = typeof data.weekdays === 'string' ? JSON.parse(data.weekdays) : data.weekdays;
      if (!Array.isArray(w) || !w.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) {
        errors.push('weekdays must be array of integers 0-6');
      }
    } catch {
      errors.push('weekdays must be valid JSON array');
    }
  }

  if (data.periods !== undefined) {
    try {
      const p = typeof data.periods === 'string' ? JSON.parse(data.periods) : data.periods;
      if (!Array.isArray(p) || !p.every(v => VALID_PERIODS.includes(v))) {
        errors.push(`periods must be array containing only: ${VALID_PERIODS.join(', ')}`);
      } else {
        // Normalize to JSON string for storage (frontend may send array or string)
        data.periods = JSON.stringify(p);
      }
    } catch {
      errors.push('periods must be valid JSON array');
    }
  }

  for (const field of ['alert_penultimate', 'alert_last', 'followup_title']) {
    if (data[field] && typeof data[field] === 'string' && data[field].length > MAX_TEXT) {
      errors.push(`${field} max ${MAX_TEXT} chars`);
    }
  }

  // Optional date window on standalone items. Empty string / null clears it.
  for (const dateField of ['start_date', 'end_date']) {
    if (data[dateField] !== undefined && data[dateField] !== null && data[dateField] !== '') {
      if (typeof data[dateField] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data[dateField])) {
        errors.push(`${dateField} must be YYYY-MM-DD`);
      } else {
        const d = new Date(data[dateField] + 'T12:00:00');
        if (isNaN(d.getTime())) errors.push(`${dateField} is not a valid date`);
      }
    }
  }
  if (data.start_date && data.end_date
      && typeof data.start_date === 'string' && typeof data.end_date === 'string'
      && data.start_date > data.end_date) {
    errors.push('start_date must be on or before end_date');
  }

  return errors;
}

// Whitelist of allowed settings keys
const ALLOWED_SETTINGS = new Set([
  'weather_lat', 'weather_lon', 'weather_tz', 'weather_city',
  'font_clock', 'font_greeting', 'font_date', 'font_weather_temp',
  'font_task_title', 'font_col_header', 'font_task_icon', 'font_progress',
  'font_task_count',
  'language',
  'period_display_mode',
  'period_morning_start', 'period_afternoon_start', 'period_night_start',
]);

const VALID_LANGUAGES = ['pt-BR', 'en', 'es'];
const VALID_DISPLAY_MODES = ['words', 'icons', 'both'];

// HH:MM → minutes since midnight (returns NaN if invalid)
function parseHHMM(str) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(str));
  if (!m) return NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return NaN;
  return h * 60 + min;
}

function validateSettings(entries) {
  const errors = [];
  for (const [key, value] of Object.entries(entries)) {
    if (!ALLOWED_SETTINGS.has(key)) {
      errors.push(`unknown setting: ${key}`);
      continue;
    }
    if (typeof value !== 'string' && typeof value !== 'number') {
      errors.push(`${key} must be string or number`);
      continue;
    }
    const str = String(value);
    if (str.length > MAX_TEXT) {
      errors.push(`${key} max ${MAX_TEXT} chars`);
    }

    // Coordinate validation
    if (key === 'weather_lat') {
      const n = Number(str);
      if (isNaN(n) || n < -90 || n > 90) errors.push('weather_lat must be between -90 and 90');
    }
    if (key === 'weather_lon') {
      const n = Number(str);
      if (isNaN(n) || n < -180 || n > 180) errors.push('weather_lon must be between -180 and 180');
    }
    if (key === 'weather_tz' && !/^[A-Za-z_]+\/[A-Za-z_\/]+$/.test(str)) {
      errors.push('weather_tz must be valid IANA timezone format (e.g. America/Sao_Paulo)');
    }
    if (key === 'language' && !VALID_LANGUAGES.includes(str)) {
      errors.push(`language must be one of: ${VALID_LANGUAGES.join(', ')}`);
    }
    if (key === 'period_display_mode' && !VALID_DISPLAY_MODES.includes(str)) {
      errors.push(`period_display_mode must be one of: ${VALID_DISPLAY_MODES.join(', ')}`);
    }
    if (key === 'period_morning_start' || key === 'period_afternoon_start' || key === 'period_night_start') {
      if (Number.isNaN(parseHHMM(str))) {
        errors.push(`${key} must be in HH:MM format (00:00–23:59)`);
      }
    }
  }

  // Cross-field check: if any of the 3 period times are being set, validate the
  // resulting full set is in chronological order. We merge the incoming changes
  // with the current stored values to evaluate the post-update state.
  const periodTimeKeys = ['period_morning_start', 'period_afternoon_start', 'period_night_start'];
  if (periodTimeKeys.some(k => k in entries)) {
    const merged = {};
    for (const k of periodTimeKeys) {
      merged[k] = (k in entries) ? String(entries[k]) : getSetting(k, k === 'period_morning_start' ? '05:00' : k === 'period_afternoon_start' ? '12:00' : '18:00');
    }
    const m = parseHHMM(merged.period_morning_start);
    const a = parseHHMM(merged.period_afternoon_start);
    const n = parseHHMM(merged.period_night_start);
    if (!Number.isNaN(m) && !Number.isNaN(a) && !Number.isNaN(n)) {
      if (!(m < a && a < n)) {
        errors.push('period times must be in chronological order: morning < afternoon < night');
      }
    }
  }

  return errors;
}

// ═══ Daily Tasks (display screen) ═══

function todayDate() {
  const tz = getSetting('weather_tz', process.env.WEATHER_TZ || 'America/Sao_Paulo');
  const parts = new Date().toLocaleDateString('en-CA', { timeZone: tz }).split('-');
  return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
}

router.get('/tasks', (req, res) => {
  const date = req.query.date || todayDate();
  const tasks = getTasksForDate(date);
  res.json(tasks);
});

router.post('/tasks/:id/toggle', (req, res) => {
  const task = toggleTask(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

// ═══ Weather ═══

router.get('/weather', async (req, res) => {
  try {
    const lat = getSetting('weather_lat', process.env.WEATHER_LAT || '-23.55');
    const lon = getSetting('weather_lon', process.env.WEATHER_LON || '-46.63');
    const tz = getSetting('weather_tz', process.env.WEATHER_TZ || 'America/Sao_Paulo');
    const data = await fetchWeather(lat, lon, tz);
    data.cityName = getSetting('weather_city', null);
    res.json(data);
  } catch (err) {
    console.error('Weather error:', err.message);
    res.status(503).json({ error: 'Weather unavailable' });
  }
});

// ═══ Geocoding (search cities) ═══

const geocodingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/geocoding', geocodingLimiter, async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json([]);

  try {
    const langSetting = getSetting('language', 'pt-BR');
    const geoLang = langSetting === 'pt-BR' ? 'pt' : langSetting;
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=${geoLang}&format=json`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const results = (data.results || []).map(r => ({
      name: r.name,
      admin: r.admin1 || '',
      country: r.country || '',
      lat: r.latitude,
      lon: r.longitude,
      timezone: r.timezone,
    }));
    res.json(results);
  } catch (err) {
    console.error('Geocoding error:', err.message);
    res.status(503).json({ error: 'Geocoding unavailable' });
  }
});

// ═══ Settings ═══

router.get('/settings', (req, res) => {
  res.json(getAllSettings());
});

router.put('/settings', requireApiAuth, (req, res) => {
  const entries = req.body;
  const errors = validateSettings(entries);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  for (const [key, value] of Object.entries(entries)) {
    setSetting(key, String(value));
  }
  res.json(getAllSettings());
});

// ═══ Routine Items (admin panel) ═══

router.get('/items', (req, res) => {
  const items = getAllRoutineItems();
  res.json(items);
});

router.post('/items', requireApiAuth, (req, res) => {
  const errors = validateItemData(req.body, true);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  const id = createRoutineItem(req.body);
  res.status(201).json({ id });
});

router.put('/items/:id', requireApiAuth, (req, res) => {
  const errors = validateItemData(req.body, false);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  const updated = updateRoutineItem(Number(req.params.id), req.body);
  if (!updated) return res.status(404).json({ error: 'Item not found' });
  res.json(updated);
});

// Soft delete (deactivate)
router.delete('/items/:id', requireApiAuth, (req, res) => {
  deactivateRoutineItem(Number(req.params.id));
  res.json({ ok: true });
});

// Permanent delete
router.delete('/items/:id/permanent', requireApiAuth, (req, res) => {
  deleteRoutineItemPermanently(Number(req.params.id));
  res.json({ ok: true });
});

// Convert a standalone item into the first phase of a new protocol.
// Body: { name?, first_phase_duration?, second_phase_duration?, repeat_indefinitely? }
router.post('/items/:id/convert-to-protocol', requireApiAuth, (req, res) => {
  try {
    const protocol = convertItemToProtocol(Number(req.params.id), req.body || {});
    if (!protocol) return res.status(404).json({ error: 'Item not found' });
    res.status(201).json(protocol);
  } catch (err) {
    if (err.code === 'ALREADY_PHASE') {
      return res.status(409).json({ error: 'Item is already a protocol phase' });
    }
    res.status(400).json({ error: err.message || 'Conversion failed' });
  }
});

// ═══ Protocols (sequences of dated phases) ═══

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PHASES = 20;

function validateProtocolData(data, isCreate) {
  const errors = [];

  if (isCreate || data.name !== undefined) {
    if (!data.name || typeof data.name !== 'string' || !data.name.trim()) {
      errors.push('name is required');
    } else if (data.name.length > MAX_TITLE) {
      errors.push(`name max ${MAX_TITLE} chars`);
    }
  }

  if (isCreate || data.start_date !== undefined) {
    if (!data.start_date || !DATE_RE.test(String(data.start_date))) {
      errors.push('start_date must be YYYY-MM-DD');
    } else {
      // Validate it's an actual date (rejects 2026-02-30 etc.)
      const d = new Date(data.start_date + 'T12:00:00');
      if (isNaN(d.getTime())) errors.push('start_date is not a valid date');
    }
  }

  if (data.repeat_indefinitely !== undefined
      && data.repeat_indefinitely !== true
      && data.repeat_indefinitely !== false
      && data.repeat_indefinitely !== 0
      && data.repeat_indefinitely !== 1) {
    errors.push('repeat_indefinitely must be boolean');
  }

  if (data.phases !== undefined) {
    if (!Array.isArray(data.phases) || data.phases.length === 0) {
      errors.push('phases must be a non-empty array');
    } else if (data.phases.length > MAX_PHASES) {
      errors.push(`phases max ${MAX_PHASES}`);
    } else {
      data.phases.forEach((phase, i) => {
        const label = `phases[${i}]`;
        if (!phase || typeof phase !== 'object') {
          errors.push(`${label} must be object`);
          return;
        }
        const duration = Number(phase.duration_days);
        if (!Number.isInteger(duration) || duration < 1 || duration > 3650) {
          errors.push(`${label}.duration_days must be integer 1–3650`);
        }
        // Reuse item validation for the config payload (title, category, etc.)
        const phaseErrors = validateItemData(phase, true);
        for (const err of phaseErrors) errors.push(`${label}: ${err}`);
      });
    }
  } else if (isCreate) {
    errors.push('phases is required');
  }

  return errors;
}

router.get('/protocols', requireApiAuth, (req, res) => {
  res.json(getProtocols());
});

router.get('/protocols/:id', requireApiAuth, (req, res) => {
  const p = getProtocol(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Protocol not found' });
  res.json(p);
});

router.post('/protocols', requireApiAuth, (req, res) => {
  const errors = validateProtocolData(req.body, true);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  const id = createProtocol(req.body);
  res.status(201).json(getProtocol(id));
});

router.put('/protocols/:id', requireApiAuth, (req, res) => {
  const errors = validateProtocolData(req.body, false);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  const updated = updateProtocol(Number(req.params.id), req.body);
  if (!updated) return res.status(404).json({ error: 'Protocol not found' });
  res.json(updated);
});

router.delete('/protocols/:id', requireApiAuth, (req, res) => {
  deleteProtocol(Number(req.params.id));
  res.json({ ok: true });
});

module.exports = router;
