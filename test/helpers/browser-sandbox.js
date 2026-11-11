// Loads the vanilla-JS front-end scripts from public/ into a node:vm context
// with a minimal fake DOM, so render helpers can be tested without jsdom.
// Every element created through document.createElement is recorded so tests
// can read back the HTML a render helper assigned to innerHTML.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', '..', 'public');

// Browsers serialise text nodes escaping only & < > (not quotes); the fake
// mirrors that so the legacy textContent -> innerHTML escaper behaves as in
// a real browser.
const serialiseText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function makeElement(created) {
  let html = '';
  let text = '';
  const el = {
    get innerHTML() { return html; },
    set innerHTML(v) { html = String(v); text = ''; },
    get textContent() { return text; },
    set textContent(v) { text = String(v); html = serialiseText(v); },
    className: '',
    dataset: {},
    style: {},
    children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild(c) { el.children.push(c); return c; },
    addEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    querySelector: () => makeElement(created),
    querySelectorAll: () => [],
    closest: () => null,
    focus() {},
    select() {},
  };
  created.push(el);
  return el;
}

function loadScripts(files, extra = {}) {
  const created = [];
  const document = {
    createElement: () => makeElement(created),
    getElementById: () => makeElement(created),
    querySelector: () => makeElement(created),
    querySelectorAll: () => [],
    addEventListener() {},
    body: makeElement(created),
  };
  const sandbox = {
    document,
    window: { addEventListener() {}, scrollX: 0, scrollY: 0 },
    navigator: { language: 'en' },
    console,
    fetch: () => new Promise(() => {}), // never settles: no network in tests
    setInterval: () => 0,
    setTimeout: () => 0,
    clearTimeout() {},
    // identity i18n: the visible text is the key (plus params when given)
    t: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key),
    getLocale: () => 'en',
    ...extra,
  };
  vm.createContext(sandbox);
  for (const f of files) {
    vm.runInContext(fs.readFileSync(path.join(PUBLIC, f), 'utf8'), sandbox, { filename: f });
  }
  return { sandbox, created };
}

module.exports = { loadScripts };
