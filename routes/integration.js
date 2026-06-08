const { Router } = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const pkg = require('../package.json');

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
  getCompletedSeries,
} = require('../db');
const { fetchWeather } = require('../weather');
const {
  validateItemData,
  validateSettings,
  validateProtocolData,
  todayDate,
} = require('../lib/validators');
const { requireBearerToken } = require('../middleware/token-auth');

const router = Router();

// ═══ Rate limiting ═══
// Per-token limit: 120 req/min. keyGenerator uses token id (populated by
// requireBearerToken) so that two tokens don't share a bucket.
const perTokenLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.apiToken ? `token:${req.apiToken.id}` : `ip:${ipKeyGenerator(req.ip)}`,
  message: { error: 'Rate limit exceeded' },
});

// Failed-auth limiter per IP: protects against brute-forcing the token space.
// Applied BEFORE requireBearerToken so it counts failed attempts too.
const authFailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60, // generous: the real limit is 120/min per valid token below
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // only count 4xx/5xx
  message: { error: 'Too many failed requests' },
});

// All /integration/v1/* routes run through these two gates.
router.use(authFailLimiter);
router.use(requireBearerToken);
router.use(perTokenLimiter);

// Light request log. Pedro has no log framework — console is the sink.
router.use((req, res, next) => {
  res.on('finish', () => {
    const prefix = req.apiToken ? req.apiToken.prefix : '-';
    console.log(`[integration] ${req.method} ${req.originalUrl} token=${prefix} ip=${req.ip} status=${res.statusCode}`);
  });
  next();
});

// ═══ Health ═══

router.get('/health', (req, res) => {
  res.json({
    ok: true,
    version: pkg.version,
    now: new Date().toISOString(),
    tz: getSetting('weather_tz', process.env.WEATHER_TZ || 'America/Sao_Paulo'),
    today: todayDate(),
    token: { prefix: req.apiToken.prefix, name: req.apiToken.name },
  });
});

// ═══ Tasks ═══

router.get('/tasks', (req, res) => {
  const date = req.query.date || todayDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }
  res.json(getTasksForDate(date));
});

router.post('/tasks/:id/toggle', (req, res) => {
  const task = toggleTask(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

// Completed series (boxes + protocol phases), newest first.
router.get('/completed', (req, res) => {
  res.json(getCompletedSeries());
});

// ═══ Items ═══

router.get('/items', (req, res) => {
  res.json(getAllRoutineItems());
});

router.post('/items', (req, res) => {
  const errors = validateItemData(req.body, true);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  const id = createRoutineItem(req.body);
  res.status(201).json({ id });
});

router.put('/items/:id', (req, res) => {
  const errors = validateItemData(req.body, false);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  const updated = updateRoutineItem(Number(req.params.id), req.body);
  if (!updated) return res.status(404).json({ error: 'Item not found' });
  res.json(updated);
});

router.delete('/items/:id', (req, res) => {
  deactivateRoutineItem(Number(req.params.id));
  res.json({ ok: true });
});

router.delete('/items/:id/permanent', (req, res) => {
  deleteRoutineItemPermanently(Number(req.params.id));
  res.json({ ok: true });
});

router.post('/items/:id/convert-to-protocol', (req, res) => {
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

// ═══ Protocols ═══

router.get('/protocols', (req, res) => {
  res.json(getProtocols());
});

router.get('/protocols/:id', (req, res) => {
  const p = getProtocol(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Protocol not found' });
  res.json(p);
});

router.post('/protocols', (req, res) => {
  const errors = validateProtocolData(req.body, true);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  const id = createProtocol(req.body);
  res.status(201).json(getProtocol(id));
});

router.put('/protocols/:id', (req, res) => {
  const errors = validateProtocolData(req.body, false);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  const updated = updateProtocol(Number(req.params.id), req.body);
  if (!updated) return res.status(404).json({ error: 'Protocol not found' });
  res.json(updated);
});

router.delete('/protocols/:id', (req, res) => {
  deleteProtocol(Number(req.params.id));
  res.json({ ok: true });
});

// ═══ Settings ═══

router.get('/settings', (req, res) => {
  res.json(getAllSettings());
});

router.put('/settings', (req, res) => {
  const entries = req.body;
  const errors = validateSettings(entries);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  for (const [key, value] of Object.entries(entries)) {
    setSetting(key, String(value));
  }
  res.json(getAllSettings());
});

// ═══ Weather (read-only passthrough) ═══

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

module.exports = router;
