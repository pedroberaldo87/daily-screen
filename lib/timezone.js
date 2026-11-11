// Time-zone helpers shared by db.js and lib/validators.js (no dependencies, so
// neither needs to require the other).
const DEFAULT_TZ = 'America/Sao_Paulo';

// True only for a zone name the runtime's Intl actually knows.
function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch (err) {
    if (err instanceof RangeError) return false;
    throw err;
  }
}

let warned = false;

// The configured zone (settings row, then WEATHER_TZ), or the default when the
// stored value is not a real zone. Never throws: a bad row must not take down
// every date lookup or stop the app from booting.
function resolveTimeZone(stored, env = process.env) {
  if (isValidTimeZone(stored)) return stored;
  if (!warned && stored != null && stored !== '') {
    warned = true;
    console.warn(`[timezone] ignoring invalid weather_tz "${String(stored).slice(0, 60)}"; using ${DEFAULT_TZ}`);
  }
  return isValidTimeZone(env.WEATHER_TZ) ? env.WEATHER_TZ : DEFAULT_TZ;
}

// Today as YYYY-MM-DD on the wall clock of `tz`.
function localDate(tz, now = new Date()) {
  const parts = now.toLocaleDateString('en-CA', { timeZone: tz }).split('-');
  return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
}

module.exports = { DEFAULT_TZ, isValidTimeZone, resolveTimeZone, localDate };
