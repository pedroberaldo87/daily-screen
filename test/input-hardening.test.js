const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp } = require('./helpers/app-harness');

const h = bootApp('input-hardening');
const { addDays } = require('../model');
const { todayDate } = require('../lib/validators');

let http;
let bearer;
let displayCookie;
const taskRows = () => h.db.prepare('SELECT COUNT(*) AS n FROM daily_tasks').get().n;

test.before(async () => {
  http = await h.listen();
  bearer = h.makeBearer();
  const pair = await http.call('GET', `/?key=${h.DISPLAY_KEY}`);
  displayCookie = { cookie: pair.headers.get('set-cookie').split(';')[0] };
  // One open-ended daily item so that any wide materialisation would write rows.
  const res = await http.call('POST', '/integration/v1/items', {
    headers: bearer,
    body: { title: 'Vitamin D', category: 'supplement', period: 'morning' },
  });
  assert.equal(res.status, 201);
});
test.after(() => http.close());

const today = () => todayDate();

// ── Finding: unbounded history/adherence span ──

test('history: an explicit span up to year 9998 is refused and writes nothing', async () => {
  const before = taskRows();
  const res = await http.call('GET', '/integration/v1/history?date_from=2026-01-01&date_to=9998-12-31', { headers: bearer });
  assert.equal(res.status, 400);
  assert.equal(taskRows(), before);
});

test('adherence/summary: a span above 3660 days is refused', async () => {
  const to = today();
  const from = addDays(to, -3660); // 3661 days inclusive
  const res = await http.call('GET', `/integration/v1/adherence/summary?date_from=${from}&date_to=${to}`, { headers: bearer });
  assert.equal(res.status, 400);
});

test('adherence: a span above 3660 days is refused', async () => {
  const to = today();
  const from = addDays(to, -3660);
  const res = await http.call('GET', `/integration/v1/adherence?item_id=1&date_from=${from}&date_to=${to}`, { headers: bearer });
  assert.equal(res.status, 400);
});

test('history: a span of exactly 3660 days is still allowed', async () => {
  const to = today();
  const from = addDays(to, -3659);
  const res = await http.call('GET', `/integration/v1/history?date_from=${from}&date_to=${to}`, { headers: bearer });
  assert.equal(res.status, 200);
});

test('history: a window far in the future is refused even when short', async () => {
  const before = taskRows();
  const res = await http.call('GET', '/integration/v1/history?date_from=9998-12-01&date_to=9998-12-31', { headers: bearer });
  assert.equal(res.status, 400);
  assert.equal(taskRows(), before);
});

test('history: dates that are not real calendar days are refused', async () => {
  for (const q of ['date_from=2026-02-31&date_to=2026-03-05', 'date_from=2026-03-01&date_to=2026-13-45']) {
    const res = await http.call('GET', `/integration/v1/history?${q}`, { headers: bearer });
    assert.equal(res.status, 400, q);
  }
});

test('history: repeated date_from/date_to parameters are refused', async () => {
  const res = await http.call('GET', '/integration/v1/history?date_from=2026-01-01&date_from=2026-01-02&date_to=2026-01-05', { headers: bearer });
  assert.equal(res.status, 400);
});

test('history: a 30-day explicit window still works', async () => {
  const to = today();
  const from = addDays(to, -29);
  const res = await http.call('GET', `/integration/v1/history?date_from=${from}&date_to=${to}`, { headers: bearer });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(await res.json()));
});

test('history: the days form is unchanged', async () => {
  assert.equal((await http.call('GET', '/integration/v1/history?days=7', { headers: bearer })).status, 200);
  assert.equal((await http.call('GET', '/integration/v1/history?days=3661', { headers: bearer })).status, 400);
});

// ── Finding: GET /api/tasks?date= creates rows for arbitrary dates ──

test('display cookie: a far-future date is refused and inserts no rows', async () => {
  const before = taskRows();
  const res = await http.call('GET', '/api/tasks?date=2999-01-01', { headers: displayCookie });
  assert.equal(res.status, 400);
  assert.equal(taskRows(), before);
});

test('display cookie: a date far in the past is refused and inserts no rows', async () => {
  const before = taskRows();
  const res = await http.call('GET', '/api/tasks?date=1999-01-01', { headers: displayCookie });
  assert.equal(res.status, 400);
  assert.equal(taskRows(), before);
});

test('/api/tasks: impossible dates, junk and repeated parameters are refused', async () => {
  for (const q of ['2026-02-31', 'abc', '2026-1-1', '']) {
    const res = await http.call('GET', `/api/tasks?date=${q}`, { headers: displayCookie });
    // empty string falls back to today, like a missing parameter
    assert.equal(res.status, q === '' ? 200 : 400, q);
  }
  const res = await http.call('GET', '/api/tasks?date=a&date=b', { headers: displayCookie });
  assert.equal(res.status, 400);
  const res2 = await http.call('GET', `/api/tasks?date=${today()}&date=${today()}`, { headers: displayCookie });
  assert.equal(res2.status, 400);
});

test('display cookie: today and the +/-31 day window still work, 32 days out does not', async () => {
  assert.equal((await http.call('GET', '/api/tasks', { headers: displayCookie })).status, 200);
  for (const date of [today(), addDays(today(), 31), addDays(today(), -31)]) {
    assert.equal((await http.call('GET', `/api/tasks?date=${date}`, { headers: displayCookie })).status, 200, date);
  }
  for (const date of [addDays(today(), 32), addDays(today(), -32)]) {
    assert.equal((await http.call('GET', `/api/tasks?date=${date}`, { headers: displayCookie })).status, 400, date);
  }
});

test('Bearer callers get the wider +/-366 day window on /api/tasks and /integration/v1/tasks', async () => {
  for (const base of ['/api/tasks', '/integration/v1/tasks']) {
    assert.equal((await http.call('GET', `${base}?date=${addDays(today(), 366)}`, { headers: bearer })).status, 200, base);
    assert.equal((await http.call('GET', `${base}?date=${addDays(today(), 367)}`, { headers: bearer })).status, 400, base);
    assert.equal((await http.call('GET', `${base}?date=2999-01-01`, { headers: bearer })).status, 400, base);
    assert.equal((await http.call('GET', `${base}?date=2026-02-31`, { headers: bearer })).status, 400, base);
  }
});

// ── Finding: idempotent replay of POST /items and /protocols with array fields ──

const itemsNamed = (title) => h.db.prepare('SELECT COUNT(*) AS n FROM templates WHERE name = ?').get(title).n;

test('POST /items with array weekdays/periods replays the same 201 on retry and creates one item', async () => {
  const body = { title: 'Replay item', category: 'supplement', weekdays: [1, 2, 3], periods: ['morning', 'night'] };
  const headers = { ...bearer, 'idempotency-key': 'item-key-1' };
  const first = await http.call('POST', '/integration/v1/items', { headers, body });
  assert.equal(first.status, 201);
  const firstBody = await first.json();
  const second = await http.call('POST', '/integration/v1/items', { headers, body });
  assert.equal(second.status, 201);
  assert.deepEqual(await second.json(), firstBody);
  assert.equal(itemsNamed('Replay item'), 1);
});

test('the same Idempotency-Key with a different body is still a 409', async () => {
  const headers = { ...bearer, 'idempotency-key': 'item-key-1' };
  const res = await http.call('POST', '/integration/v1/items', {
    headers,
    body: { title: 'Replay item', category: 'supplement', weekdays: [1, 2, 4], periods: ['morning', 'night'] },
  });
  assert.equal(res.status, 409);
});

test('POST /protocols with array phase weekdays replays on retry and creates one protocol', async () => {
  const body = {
    name: 'Replay protocol',
    start_date: today(),
    phases: [{ title: 'Phase', category: 'medication', duration_days: 7, weekdays: [1, 3, 5], periods: ['morning'] }],
  };
  const headers = { ...bearer, 'idempotency-key': 'proto-key-1' };
  const first = await http.call('POST', '/integration/v1/protocols', { headers, body });
  assert.equal(first.status, 201);
  const firstBody = await first.json();
  const second = await http.call('POST', '/integration/v1/protocols', { headers, body });
  assert.equal(second.status, 201);
  assert.deepEqual(await second.json(), firstBody);
  const n = h.db.prepare('SELECT COUNT(*) AS n FROM templates WHERE name = ?').get('Replay protocol').n;
  assert.equal(n, 1);
});
