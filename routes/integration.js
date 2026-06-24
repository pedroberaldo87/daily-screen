const { Router } = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const crypto = require('crypto');
const pkg = require('../package.json');

const {
  getTasksForDate,
  getTask,
  toggleTask,
  setTaskCompleted,
  recreateFromFollowup,
  deleteTaskItem,
  getAllRoutineItems,
  getRoutineItem,
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
  getHistory,
  getItemAdherence,
  getAdherenceSummary,
  getApiIdempotencyKey,
  saveApiIdempotencyKey,
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
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashRequestBody(body) {
  return crypto.createHash('sha256').update(stableStringify(body || null)).digest('hex');
}

function sendIdempotent(req, res, payload, statusCode) {
  const key = req.get('Idempotency-Key');
  if (!key) return res.status(statusCode).json(payload);
  saveApiIdempotencyKey({
    tokenId: req.apiToken.id,
    method: req.method,
    path: req.route.path,
    idempotencyKey: key,
    requestHash: hashRequestBody(req.body),
    statusCode,
    responseBody: payload,
  });
  return res.status(statusCode).json(payload);
}

function maybeReplayIdempotent(req, res) {
  const key = req.get('Idempotency-Key');
  if (!key) return null;
  const existing = getApiIdempotencyKey({
    tokenId: req.apiToken.id,
    method: req.method,
    path: req.route.path,
    idempotencyKey: key,
  });
  if (!existing) return null;
  const requestHash = hashRequestBody(req.body);
  if (existing.request_hash !== requestHash) {
    res.status(409).json({ error: 'Idempotency-Key already used with a different payload' });
    return 'handled';
  }
  res.status(existing.status_code).json(existing.response_body);
  return 'handled';
}

function resolveDateRange(query, defaultDays = 30) {
  if (query.date_from || query.date_to) {
    const dateFrom = query.date_from;
    const dateTo = query.date_to;
    if (!DATE_RE.test(String(dateFrom || '')) || !DATE_RE.test(String(dateTo || ''))) {
      return { error: 'date_from and date_to must be YYYY-MM-DD' };
    }
    if (dateFrom > dateTo) return { error: 'date_from must be on or before date_to' };
    return { dateFrom, dateTo };
  }
  const days = Number(query.days || defaultDays);
  if (!Number.isInteger(days) || days < 1 || days > 3660) {
    return { error: 'days must be integer 1-3660' };
  }
  const dateTo = todayDate();
  const dateFrom = require('../model').addDays(dateTo, -(days - 1));
  return { dateFrom, dateTo, days };
}

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

router.get('/tasks/:id', (req, res) => {
  const task = getTask(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

router.post('/tasks/:id/toggle', (req, res) => {
  const task = toggleTask(Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

router.put('/tasks/:id', (req, res) => {
  const { completed } = req.body || {};
  if (completed !== true && completed !== false && completed !== 1 && completed !== 0) {
    return res.status(400).json({ error: 'completed must be boolean' });
  }
  const task = setTaskCompleted(Number(req.params.id), completed);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

router.post('/tasks/:id/recreate', (req, res) => {
  const result = recreateFromFollowup(Number(req.params.id), todayDate());
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.delete('/tasks/:id', (req, res) => {
  const result = deleteTaskItem(Number(req.params.id));
  if (!result.ok) return res.status(404).json(result);
  res.json(result);
});

// Completed series (boxes + protocol phases), newest first.
router.get('/completed', (req, res) => {
  res.json(getCompletedSeries());
});

// ═══ Items ═══

router.get('/items', (req, res) => {
  res.json(getAllRoutineItems());
});

router.get('/items/:id', (req, res) => {
  const item = getRoutineItem(Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'Item not found' });
  res.json(item);
});

router.post('/items', (req, res) => {
  if (maybeReplayIdempotent(req, res)) return;
  const errors = validateItemData(req.body, true);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  const id = createRoutineItem(req.body);
  const item = getRoutineItem(id);
  sendIdempotent(req, res, item, 201);
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
  if (maybeReplayIdempotent(req, res)) return;
  const errors = validateProtocolData(req.body, true);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  const id = createProtocol(req.body);
  sendIdempotent(req, res, getProtocol(id), 201);
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

// ═══ Analytics ═══

router.get('/history', (req, res) => {
  const { dateFrom, dateTo, error } = resolveDateRange(req.query, 30);
  if (error) return res.status(400).json({ error });
  const category = req.query.category || null;
  const itemId = req.query.item_id !== undefined ? Number(req.query.item_id) : null;
  const protocolId = req.query.protocol_id !== undefined ? Number(req.query.protocol_id) : null;
  if (itemId !== null && !Number.isInteger(itemId)) return res.status(400).json({ error: 'item_id must be integer' });
  if (protocolId !== null && !Number.isInteger(protocolId)) return res.status(400).json({ error: 'protocol_id must be integer' });
  res.json(getHistory({ dateFrom, dateTo, category, itemId, protocolId }));
});

router.get('/adherence', (req, res) => {
  const itemId = Number(req.query.item_id);
  if (!Number.isInteger(itemId)) return res.status(400).json({ error: 'item_id must be integer' });
  const { dateFrom, dateTo, error } = resolveDateRange(req.query, 30);
  if (error) return res.status(400).json({ error });
  const stats = getItemAdherence({ itemId, dateFrom, dateTo });
  if (!stats) return res.status(404).json({ error: 'Item not found' });
  res.json(stats);
});

router.get('/adherence/summary', (req, res) => {
  const { dateFrom, dateTo, error } = resolveDateRange(req.query, 7);
  if (error) return res.status(400).json({ error });
  const category = req.query.category || null;
  res.json(getAdherenceSummary({ dateFrom, dateTo, category }));
});

module.exports = router;
