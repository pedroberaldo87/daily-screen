// Review round 1 for the CSP / inline-handler change:
//  - sw.js must not trap an unpaired tablet in a reload loop,
//  - the 401 path in display.js must drop the service worker before reloading,
//  - button binding must survive an earlier exception and not leak globals,
//  - showRecreatePrompt must not stack listeners.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

// ── sw.js fetch handler, evaluated with a fake self / caches / fetch ──────────

function makeSw({ fetchImpl, cached = {} }) {
  const handlers = {};
  const store = new Map(Object.entries(cached)); // url -> Response-like
  const puts = [];
  class FakeResponse {
    constructor(body, init = {}) { this.body = body; this.status = init.status || 200; this.ok = this.status >= 200 && this.status < 300; }
    clone() { return new FakeResponse(this.body, { status: this.status }); }
  }
  const cache = {
    addAll: async () => {},
    put: async (req, res) => { puts.push(req.url); store.set(req.url, res); },
  };
  const sandbox = {
    URL,
    Response: FakeResponse,
    JSON,
    Promise,
    self: {
      addEventListener: (type, fn) => { handlers[type] = fn; },
      skipWaiting() {},
      clients: { claim() {} },
    },
    caches: {
      open: async () => cache,
      match: async (req) => store.get(req.url),
      keys: async () => [],
      delete: async () => true,
    },
    fetch: fetchImpl,
  };
  vm.createContext(sandbox);
  vm.runInContext(read('sw.js'), sandbox, { filename: 'sw.js' });
  const cacheName = vm.runInContext('CACHE_NAME', sandbox);
  async function request(req) {
    let responded;
    handlers.fetch({ request: req, respondWith: (p) => { responded = Promise.resolve(p); } });
    assert.ok(responded, 'fetch handler must call respondWith');
    return responded;
  }
  return { request, puts, cacheName, FakeResponse };
}

const navigate = (url = 'https://tablet.example.com/') => ({ url, mode: 'navigate', method: 'GET' });

test('sw: a navigation that gets 401 is passed through, not answered from the cached shell', async () => {
  const stale = { body: 'cached display shell', status: 200, ok: true };
  const unpaired = { body: 'not paired', status: 401, ok: false, clone() { return this; } };
  const sw = makeSw({
    fetchImpl: async () => unpaired,
    cached: { 'https://tablet.example.com/': stale },
  });
  const res = await sw.request(navigate());
  assert.equal(res.status, 401);
  assert.equal(res.body, 'not paired');
  assert.deepEqual(sw.puts, [], 'a 401 must never be cached');
});

test('sw: a navigation falls back to the cached shell only when the network fails', async () => {
  const stale = { body: 'cached display shell', status: 200, ok: true };
  const sw = makeSw({
    fetchImpl: async () => { throw new TypeError('offline'); },
    cached: { 'https://tablet.example.com/': stale },
  });
  const res = await sw.request(navigate());
  assert.equal(res.body, 'cached display shell');
});

test('sw: a successful navigation refreshes the cached shell', async () => {
  const fresh = { body: 'fresh shell', status: 200, ok: true, clone() { return this; } };
  const sw = makeSw({ fetchImpl: async () => fresh });
  const res = await sw.request(navigate());
  assert.equal(res.body, 'fresh shell');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(sw.puts, ['https://tablet.example.com/']);
});

test('sw: static shell assets stay cache-first', async () => {
  const cachedCss = { body: 'css', status: 200, ok: true };
  let fetched = 0;
  const sw = makeSw({
    fetchImpl: async () => { fetched += 1; return { status: 200, ok: true, body: 'net' }; },
    cached: { 'https://tablet.example.com/public/style.css': cachedCss },
  });
  const res = await sw.request({ url: 'https://tablet.example.com/public/style.css', mode: 'no-cors', method: 'GET' });
  assert.equal(res.body, 'css');
  assert.equal(fetched, 0);
});

test('sw: cache name is bumped past v28 so tablets drop the cache-first shell', () => {
  const sw = makeSw({ fetchImpl: async () => ({}) });
  assert.notEqual(sw.cacheName, 'daily-screen-v28');
  assert.notEqual(sw.cacheName, 'daily-screen-v27');
});

// ── fake DOM with persistent elements and real listener tracking ──────────────

function makeDom() {
  const byId = new Map();
  function makeEl(id) {
    const listeners = {};
    const el = {
      id,
      textContent: '', innerHTML: '', className: '', value: '',
      dataset: {}, style: {}, children: [],
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      appendChild(c) { el.children.push(c); return c; },
      addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
      removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
      listenerCount: (type) => (listeners[type] || []).length,
      async click() { for (const fn of [...(listeners.click || [])]) await fn({ preventDefault() {} }); },
      setAttribute() {}, removeAttribute() {}, focus() {}, select() {},
      querySelector: () => makeEl(null),
      querySelectorAll: () => [],
      closest: () => null,
    };
    return el;
  }
  const document = {
    getElementById: (id) => {
      if (!byId.has(id)) byId.set(id, makeEl(id));
      return byId.get(id);
    },
    createElement: () => makeEl(null),
    querySelector: () => makeEl(null),
    querySelectorAll: () => [],
    addEventListener() {},
    body: makeEl('body'),
  };
  return { document, makeEl };
}

function loadInto(sandbox, files) {
  vm.createContext(sandbox);
  for (const f of files) vm.runInContext(read(f), sandbox, { filename: f });
}

function displaySandbox(extra = {}) {
  const dom = makeDom();
  const sandbox = {
    document: dom.document,
    window: { addEventListener() {}, scrollX: 0, scrollY: 0 },
    navigator: { language: 'en' },
    location: { reload() {} },
    console,
    fetch: () => new Promise(() => {}),
    setInterval: () => 0,
    setTimeout: () => 0,
    clearTimeout() {},
    t: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key),
    getLocale: () => 'en',
    getDateFormat: () => 'dmy',
    initI18n: async () => {},
    applyTranslations() {},
    ...extra,
  };
  return { sandbox, dom };
}

test('display: on 401 the service worker and caches are removed before the reload', async () => {
  const log = [];
  const registration = { unregister: async () => { log.push('unregister'); return true; } };
  const { sandbox } = displaySandbox({
    navigator: {
      language: 'en',
      serviceWorker: { getRegistrations: async () => [registration] },
    },
    caches: {
      keys: async () => ['daily-screen-v28'],
      delete: async (k) => { log.push(`delete:${k}`); return true; },
    },
    location: { reload: () => log.push('reload') },
    fetch: async () => ({ status: 401, ok: false }),
  });
  loadInto(sandbox, ['utils.js', 'display.js']);
  log.length = 0;
  await sandbox.fetchTasks(true);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(log.slice(0, 3), ['unregister', 'delete:daily-screen-v28', 'reload'], log.join(','));
});

test('display: showRecreatePrompt called twice then one "yes" posts only the latest task', async () => {
  const posts = [];
  const { sandbox, dom } = displaySandbox({
    fetch: async (url, opts) => {
      if (opts && opts.method === 'POST') posts.push(url);
      return { status: 200, ok: true, json: async () => [] };
    },
  });
  loadInto(sandbox, ['utils.js', 'display.js']);
  sandbox.showRecreatePrompt(1, { icon: 'x', title: 'one' });
  sandbox.showRecreatePrompt(2, { icon: 'x', title: 'two' });
  assert.equal(dom.document.getElementById('recreate-yes').listenerCount('click'), 1);
  await dom.document.getElementById('recreate-yes').click();
  assert.deepEqual(posts, ['/api/tasks/2/recreate']);
});

// ── button binding in the admin scripts ───────────────────────────────────────

function dataClickButtons(dom, names) {
  return names.map((n) => {
    const el = dom.makeEl(null);
    el.dataset = { click: n };
    el.tagName = 'BUTTON';
    return el;
  });
}

test('admin.js: buttons are bound even when a later top-level statement throws', () => {
  const { sandbox, dom } = displaySandbox();
  const buttons = dataClickButtons(dom, ['openSettingsModal', 'closeConfirm']);
  // Make the rest of the script blow up: unknown ids resolve to null.
  dom.document.getElementById = () => null;
  dom.document.querySelectorAll = (sel) => (sel === '[data-click]' ? buttons : []);
  vm.createContext(sandbox);
  vm.runInContext(read('utils.js'), sandbox);
  assert.throws(() => vm.runInContext(read('admin.js'), sandbox, { filename: 'admin.js' }));
  assert.deepEqual(buttons.map((b) => b.listenerCount('click')), [1, 1]);
});

test('admin-tokens.js: buttons are bound even when a later top-level statement throws', () => {
  const { sandbox, dom } = displaySandbox();
  const buttons = dataClickButtons(dom, ['openCreateModal', 'closeRevealModal']);
  dom.document.getElementById = () => null;
  dom.document.querySelectorAll = (sel) => (sel === '[data-click]' ? buttons : []);
  vm.createContext(sandbox);
  vm.runInContext(read('utils.js'), sandbox);
  try { vm.runInContext(read('admin-tokens.js'), sandbox, { filename: 'admin-tokens.js' }); } catch (e) { /* expected */ }
  assert.deepEqual(buttons.map((b) => b.listenerCount('click')), [1, 1]);
});

test('admin.js and admin-tokens.js can load in one global scope (no top-level CLICK_HANDLERS)', () => {
  const { sandbox } = displaySandbox();
  vm.createContext(sandbox);
  vm.runInContext(read('utils.js'), sandbox);
  const run = (f) => { try { vm.runInContext(read(f), sandbox, { filename: f }); } catch (e) { return e; } return null; };
  const e1 = run('admin.js');
  const e2 = run('admin-tokens.js');
  for (const e of [e1, e2]) {
    assert.ok(!(e && e instanceof SyntaxError && /already been declared/.test(e.message)), String(e));
  }
  assert.equal(vm.runInContext('typeof CLICK_HANDLERS', sandbox), 'undefined');
});
