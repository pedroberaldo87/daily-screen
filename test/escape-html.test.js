const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeHtml } = require('../public/utils.js');
const { loadScripts } = require('./helpers/browser-sandbox');

const ATTR_BREAKOUT = '" onmouseover="alert(document.domain)" x="';
const TAG_BREAKOUT = '<img src=x onerror=alert(1)>';

test('escapeHtml encodes & < > " \' and backtick', () => {
  assert.equal(escapeHtml('&'), '&amp;');
  assert.equal(escapeHtml('<'), '&lt;');
  assert.equal(escapeHtml('>'), '&gt;');
  assert.equal(escapeHtml('"'), '&quot;');
  assert.equal(escapeHtml("'"), '&#39;');
  assert.equal(escapeHtml('`'), '&#96;');
});

test('escapeHtml neutralises a double-quote attribute breakout', () => {
  const out = escapeHtml(ATTR_BREAKOUT);
  assert.ok(!out.includes('"'), out);
  assert.ok(!out.includes('<'), out);
});

test('escapeHtml escapes & first so entities are not double-decoded', () => {
  assert.equal(escapeHtml('&quot;'), '&amp;quot;');
});

test('escapeHtml stringifies numbers and keeps 0; null/undefined/"" give ""', () => {
  assert.equal(escapeHtml(0), '0');
  assert.equal(escapeHtml(42), '42');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(''), '');
});

test('escapeHtml stringifies non-string values instead of emitting markup', () => {
  assert.equal(escapeHtml(TAG_BREAKOUT), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(escapeHtml({ toString: () => '"x"' }), '&quot;x&quot;');
});

// ── Render helpers: payloads in item/protocol fields must not reach the DOM raw ──

function htmlOf(created) {
  return created.map((e) => e.innerHTML).join('\n');
}

// A raw payload would show up as a real attribute or element in the markup.
function assertNoInjection(html) {
  // a real injection needs a raw quote right before the new attribute
  assert.ok(!/["']\s*onmouseover=/i.test(html), `attribute injected:\n${html}`);
  assert.ok(!/<img\b/i.test(html), `element injected:\n${html}`);
  assert.ok(!/<script\b/i.test(html), `script injected:\n${html}`);
}

test('admin item card escapes quotes in title/alert/followup attributes', () => {
  const { sandbox, created } = loadScripts(['utils.js', 'admin.js']);
  sandbox.buildItemCard({
    id: 1, title: ATTR_BREAKOUT, category: 'medication', icon: '💊', active: 1,
    weekdays: '[1]', periods: '[]', repeat_every: 1, repeat_unit: 'week',
    alert_penultimate: ATTR_BREAKOUT, alert_last: ATTR_BREAKOUT, followup_title: ATTR_BREAKOUT,
    series: [{ status: 'active', seq: 1, completed_count: 0, total_count: TAG_BREAKOUT }],
  });
  const html = htmlOf(created);
  assertNoInjection(html);
  assert.match(html, /data-delete-title="&quot; onmouseover=&quot;alert\(document\.domain\)&quot; x=&quot;"/);
});

test('admin protocol card escapes quotes in alert/followup attributes', () => {
  const { sandbox, created } = loadScripts(['utils.js', 'admin.js']);
  sandbox.buildProtocolCard({
    id: 7, name: ATTR_BREAKOUT, active: 1, repeat_indefinitely: 0,
    alert_penultimate: ATTR_BREAKOUT, alert_last: ATTR_BREAKOUT, followup_title: ATTR_BREAKOUT,
    phases: [],
  });
  assertNoInjection(htmlOf(created));
});

test('admin phase card escapes quotes in the phase title input value', () => {
  const { sandbox, created } = loadScripts(['utils.js', 'admin.js']);
  sandbox.buildPhaseCard({ title: ATTR_BREAKOUT, icon: ATTR_BREAKOUT, duration_days: TAG_BREAKOUT, total_count: TAG_BREAKOUT });
  assertNoInjection(htmlOf(created));
});

test('display task element escapes total_count / completed_count', () => {
  const { sandbox, created } = loadScripts(['utils.js', 'display.js']);
  sandbox.createTaskElement({
    id: 1, category: 'medication', title: ATTR_BREAKOUT, icon: '💊', completed: false,
    completed_count: TAG_BREAKOUT, total_count: TAG_BREAKOUT,
    alert: { type: ATTR_BREAKOUT, message: ATTR_BREAKOUT },
  });
  assertNoInjection(htmlOf(created));
});

test('admin-tokens list escapes token fields, dates and ids', () => {
  const { sandbox, created } = loadScripts(['utils.js', 'admin-tokens.js']);
  sandbox.renderTokens([
    { id: `1)"><img src=x onerror=alert(1)>`, name: ATTR_BREAKOUT, token_prefix: TAG_BREAKOUT,
      created_at: TAG_BREAKOUT, last_used_at: TAG_BREAKOUT, expires_at: null, revoked_at: null },
  ]);
  const html = htmlOf(created);
  assertNoInjection(html);
  assert.ok(!html.includes('alert(1)>'), html);
});

test('admin history row escapes id/date values used in data attributes', () => {
  const { sandbox } = loadScripts(['utils.js', 'admin.js']);
  const html = sandbox.historyRow({
    id: ATTR_BREAKOUT, date: '2026-06-01', completed: 0, fits_rule: 1, origin: 'auto', total_count: 0,
  });
  assertNoInjection(html);
  const html2 = sandbox.historyRow({
    id: 1, date: ATTR_BREAKOUT + '2026-06-01', completed: 0, fits_rule: 1, origin: 'auto', total_count: 0,
  });
  assertNoInjection(html2);
});
