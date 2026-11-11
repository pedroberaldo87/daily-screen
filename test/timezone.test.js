const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const dbPath = path.join(os.tmpdir(), `ds-tz-test-${process.pid}.db`);
process.env.DATABASE_PATH = dbPath;
delete process.env.WEATHER_TZ;
const { setSetting } = require('../db');
const { validateSettings, todayDate } = require('../lib/validators');

test.after(() => { for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) fs.rmSync(f, { force: true }); });

test('weather_tz: real IANA zones are accepted', () => {
  for (const tz of ['America/Sao_Paulo', 'Europe/Lisbon', 'America/Argentina/Buenos_Aires']) {
    assert.deepEqual(validateSettings({ weather_tz: tz }), [], tz);
  }
});

test('weather_tz: well-shaped names that are not real zones are refused', () => {
  for (const tz of ['Foo/Bar', 'America/Nowhere', 'Not/A_Zone/At_All']) {
    const errors = validateSettings({ weather_tz: tz });
    assert.ok(errors.some((e) => e.includes('weather_tz')), `accepted ${tz}`);
  }
});

test('todayDate falls back to the default zone when the stored zone is invalid', () => {
  setSetting('weather_tz', 'Foo/Bar');
  const day = todayDate();
  assert.match(day, /^\d{4}-\d{2}-\d{2}$/);
  const expected = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  assert.equal(day, expected);
  setSetting('weather_tz', 'America/Sao_Paulo');
});

test('a database that already holds an invalid zone still boots', () => {
  const bootDb = path.join(os.tmpdir(), `ds-tz-boot-${process.pid}.db`);
  const run = (code) => execFileSync(process.execPath, ['-e', code], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_PATH: bootDb },
    encoding: 'utf8',
  });
  try {
    run("require('./db').setSetting('weather_tz', 'Foo/Bar')");
    const out = run("const d = require('./db'); console.log(d.getSetting('weather_tz'))");
    assert.match(out, /Foo\/Bar/);
  } finally {
    for (const f of [bootDb, `${bootDb}-wal`, `${bootDb}-shm`]) fs.rmSync(f, { force: true });
  }
});
