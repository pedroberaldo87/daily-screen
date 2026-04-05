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

const router = Router();

// Auth middleware for write operations (returns 401 JSON, not redirect)
function requireApiAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  res.status(401).json({ error: 'Authentication required' });
}

// ═══ Daily Tasks (display screen) ═══

function todayDate() {
  return new Date().toISOString().split('T')[0];
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

router.get('/geocoding', async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json([]);

  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=pt&format=json`;
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
  const { title, category } = req.body;
  if (!title || !category) {
    return res.status(400).json({ error: 'title and category are required' });
  }
  const id = createRoutineItem(req.body);
  res.status(201).json({ id });
});

router.put('/items/:id', requireApiAuth, (req, res) => {
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
