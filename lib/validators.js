const { getSetting } = require('../db');

// ═══ Constants ═══

const VALID_CATEGORIES = ['medication', 'supplement', 'reminder'];
const VALID_PERIODS = ['morning', 'afternoon', 'night'];
const MAX_TITLE = 200;
const MAX_TEXT = 500;
const MAX_ICON = 10;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PHASES = 20;

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

// ═══ Helpers ═══

// HH:MM → minutes since midnight (returns NaN if invalid)
function parseHHMM(str) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(str));
  if (!m) return NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return NaN;
  return h * 60 + min;
}

// ═══ Validators ═══

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
        const phaseErrors = validateItemData(phase, true);
        for (const err of phaseErrors) errors.push(`${label}: ${err}`);
      });
    }
  } else if (isCreate) {
    errors.push('phases is required');
  }

  for (const field of ['alert_penultimate', 'alert_last', 'followup_title']) {
    if (data[field] != null && typeof data[field] === 'string' && data[field].length > MAX_TEXT) {
      errors.push(`${field} max ${MAX_TEXT} chars`);
    }
  }
  if (data.followup_category != null && !['medication', 'supplement', 'reminder'].includes(data.followup_category)) {
    errors.push('followup_category inválido');
  }

  return errors;
}

// ═══ Date helpers ═══

function todayDate() {
  const tz = getSetting('weather_tz', process.env.WEATHER_TZ || 'America/Sao_Paulo');
  const parts = new Date().toLocaleDateString('en-CA', { timeZone: tz }).split('-');
  return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
}

module.exports = {
  // Constants
  VALID_CATEGORIES,
  VALID_PERIODS,
  VALID_LANGUAGES,
  VALID_DISPLAY_MODES,
  ALLOWED_SETTINGS,
  MAX_TITLE,
  MAX_TEXT,
  MAX_ICON,
  MAX_PHASES,
  DATE_RE,
  // Validators
  validateItemData,
  validateSettings,
  validateProtocolData,
  // Helpers
  parseHHMM,
  todayDate,
};
