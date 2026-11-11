const { Router } = require('express');
const {
  getTasksForDate,
  toggleTask,
  recreateFromFollowup,
  deleteTaskItem,
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
  getCompletedSeries,
} = require('../db');
const { fetchWeather } = require('../weather');
const { mountOccurrences } = require('./occurrences');
const { resolveTimeZone } = require('../lib/timezone');
const {
  validateItemData,
  validateSettings,
  validateProtocolData,
  todayDate,
  checkDateWindow,
} = require('../lib/validators');

const rateLimit = require('express-rate-limit');
const { requireApiCaller, requirePrivileged } = require('../middleware/api-auth');

const router = Router();

// Every /api/* route needs a caller: admin session, Bearer integration token, or
// the paired display cookie (which only reaches the endpoints the display page
// calls — see middleware/api-auth.js). Failed attempts are throttled per IP;
// only 401s count, so legitimate 4xx answers never lock anyone out.
const authFailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  requestWasSuccessful: (req, res) => res.statusCode !== 401,
  message: { error: 'Too many failed requests' },
});
router.use(authFailLimiter);
router.use(requireApiCaller);

// Management routes: admin session or integration token, never the display.
const requireApiAuth = requirePrivileged;

// Location (weather_lat / weather_lon, ~10 m precision) is only for the admin session.
const LOCATION_SETTINGS = ['weather_lat', 'weather_lon'];
function settingsFor(req) {
  const settings = getAllSettings();
  if (req.auth && req.auth.type === 'admin') return settings;
  for (const key of LOCATION_SETTINGS) delete settings[key];
  return settings;
}

// ═══ Daily Tasks (display screen) ═══

// getTasksForDate writes the day's rows before reading them, so the date is
// checked first. The wall display steps a day at a time around today and gets a
// narrow window; admin and Bearer callers (backfill, planning) get a year each way.
const DISPLAY_DATE_WINDOW_DAYS = 31;
const PRIVILEGED_DATE_WINDOW_DAYS = 366;

router.get('/tasks', (req, res) => {
  const today = todayDate();
  const raw = req.query.date === '' || req.query.date === undefined ? today : req.query.date;
  const days = req.auth && req.auth.type === 'display' ? DISPLAY_DATE_WINDOW_DAYS : PRIVILEGED_DATE_WINDOW_DAYS;
  const { date, error } = checkDateWindow(raw, { today, pastDays: days, futureDays: days });
  if (error) return res.status(400).json({ error });
  res.json(getTasksForDate(date));
});

router.post('/tasks/:id/toggle', (req, res) => {
  const task = toggleTask(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

// User confirmed "Sim" on the recreate prompt for a completed follow-up.
// Reachable by the paired display, like /toggle.
router.post('/tasks/:id/recreate', (req, res) => {
  const result = recreateFromFollowup(Number(req.params.id), todayDate());
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

// Remove the item/protocol behind a task. Admin or integration token only — the
// paired display cannot call it. It only archives (reversible in the admin).
router.delete('/tasks/:id', requireApiAuth, (req, res) => {
  const result = deleteTaskItem(Number(req.params.id), { archiveOnly: true });
  if (!result.ok) return res.status(404).json(result);
  res.json(result);
});

// Completed series (boxes + protocol phases) for the "Concluídos" panel; the
// paired display may read it, like /tasks.
router.get('/completed', (req, res) => {
  res.json(getCompletedSeries());
});

// ═══ Weather ═══

router.get('/weather', async (req, res) => {
  try {
    const lat = getSetting('weather_lat', process.env.WEATHER_LAT || '-23.55');
    const lon = getSetting('weather_lon', process.env.WEATHER_LON || '-46.63');
    const tz = resolveTimeZone(getSetting('weather_tz', process.env.WEATHER_TZ || 'America/Sao_Paulo'));
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

router.get('/geocoding', requireApiAuth, geocodingLimiter, async (req, res) => {
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
  res.json(settingsFor(req));
});

router.put('/settings', requireApiAuth, (req, res) => {
  const entries = req.body;
  const errors = validateSettings(entries);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  for (const [key, value] of Object.entries(entries)) {
    setSetting(key, String(value));
  }
  res.json(settingsFor(req));
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
router.post('/items/:id/convert-to-protocol', requireApiAuth, (req, res) => {
  // Full form (admin's conversion draft): validate like a protocol create.
  if (req.body && req.body.phases !== undefined) {
    const errors = validateProtocolData(req.body, true);
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  }
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

// ═══ Occurrences (admin "Histórico" of each repeated item) ═══
mountOccurrences(router, requireApiAuth);

// ═══ Protocols (sequences of dated phases) ═══

router.get('/protocols', requireApiAuth, (req, res) => {
  res.json(getProtocols({ includeInactive: req.query.include_inactive === '1' }));
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
