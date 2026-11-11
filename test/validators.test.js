const test = require('node:test');
const assert = require('node:assert/strict');
const { validateItemData, validateProtocolData } = require('../lib/validators');

const okItem = (extra = {}) => ({ title: 'Magnesium', category: 'supplement', ...extra });
const phase = (extra = {}) => ({
  title: '25mg', category: 'medication', icon: '💊', duration_days: 7, ...extra,
});
const proto = (phaseExtra = {}, extra = {}) => ({
  name: 'Taper', start_date: '2026-06-01', phases: [phase(phaseExtra)], ...extra,
});

// ── total_count ──

test('items: total_count accepts integers 1..100000 and null', () => {
  for (const v of [1, 30, 100000, null, undefined]) {
    assert.deepEqual(validateItemData(okItem({ total_count: v }), true), [], String(v));
  }
});

test('items: total_count rejects markup, non-integers and out-of-range values', () => {
  const bad = ['<img src=x onerror=alert(1)>', '"><script>', 'abc', 1.5, 0, -1, 100001, NaN, '', {}, [], true];
  for (const v of bad) {
    const errors = validateItemData(okItem({ total_count: v }), true);
    assert.ok(errors.some((e) => e.includes('total_count')), `accepted ${JSON.stringify(v)}`);
  }
});

test('items: total_count is validated on update too', () => {
  const errors = validateItemData({ total_count: '<b>x</b>' }, false);
  assert.ok(errors.some((e) => e.includes('total_count')));
});

test('protocol phases: total_count rejects markup and out-of-range values', () => {
  assert.deepEqual(validateProtocolData(proto({ total_count: 14 }), true), []);
  assert.deepEqual(validateProtocolData(proto({ total_count: null }), true), []);
  for (const v of ['<img src=x onerror=alert(1)>', 0, 100001, 2.5]) {
    const errors = validateProtocolData(proto({ total_count: v }), true);
    assert.ok(errors.some((e) => e.includes('phases[0]') && e.includes('total_count')), `accepted ${JSON.stringify(v)}`);
  }
});

// ── followup_category / followup_icon / active on items ──

test('items: followup_category must be a valid category', () => {
  for (const v of ['medication', 'supplement', 'reminder', null, undefined, '']) {
    assert.deepEqual(validateItemData(okItem({ followup_category: v }), true), [], String(v));
  }
  for (const v of ['"><script>', 'other', 5, {}]) {
    const errors = validateItemData(okItem({ followup_category: v }), true);
    assert.ok(errors.some((e) => e.includes('followup_category')), `accepted ${JSON.stringify(v)}`);
  }
});

test('items: followup_icon respects the icon length limit', () => {
  assert.deepEqual(validateItemData(okItem({ followup_icon: '📌' }), true), []);
  const errors = validateItemData(okItem({ followup_icon: 'x'.repeat(11) }), true);
  assert.ok(errors.some((e) => e.includes('followup_icon')));
});

test('protocols: followup_icon respects the icon length limit', () => {
  const errors = validateProtocolData(proto({}, { followup_icon: 'x'.repeat(11) }), true);
  assert.ok(errors.some((e) => e.includes('followup_icon')));
});

test('items: active must be boolean-like', () => {
  for (const v of [true, false, 0, 1, undefined]) {
    assert.deepEqual(validateItemData(okItem({ active: v }), false), [], String(v));
  }
  for (const v of ['<b>', 'yes', 2, {}]) {
    const errors = validateItemData(okItem({ active: v }), false);
    assert.ok(errors.some((e) => e.includes('active')), `accepted ${JSON.stringify(v)}`);
  }
});
