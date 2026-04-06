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

  for (const field of ['alert_penultimate', 'alert_last', 'followup_title']) {
    if (data[field] && typeof data[field] === 'string' && data[field].length > MAX_TEXT) {
      errors.push(`${field} max ${MAX_TEXT} chars`);
    }
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
]);

const VALID_LANGUAGES = ['pt-BR', 'en', 'es'];

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

module.exports = router;
