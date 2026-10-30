const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

// db.js opens DATABASE_PATH on require — point it at a throwaway file.
process.env.DATABASE_PATH = path.join(os.tmpdir(), `ds-token-test-${process.pid}.db`);
const { createApiToken } = require('../db');
const { requireBearerToken, generateToken } = require('../middleware/token-auth');

function call(expiresAt) {
  const { plaintext, hash, prefix } = generateToken();
  createApiToken({ name: 't', tokenPrefix: prefix, tokenHash: hash, expiresAt });
  const req = { get: (h) => (h.toLowerCase() === 'authorization' ? `Bearer ${plaintext}` : undefined), ip: '127.0.0.1', method: 'GET', originalUrl: '/x' };
  let status = 200;
  let passed = false;
  const res = { status(s) { status = s; return this; }, json() { return this; } };
  requireBearerToken(req, res, () => { passed = true; });
  return { status, passed };
}

test('token vencido em ISO com Z (formato que o painel grava) é recusado', () => {
  assert.deepEqual(call('2020-01-01T00:00:00.000Z'), { status: 401, passed: false });
});

test('token vencido no formato do SQLite (sem fuso) é recusado', () => {
  assert.deepEqual(call('2020-01-01 00:00:00'), { status: 401, passed: false });
});

test('token com validade futura passa', () => {
  assert.deepEqual(call('2099-01-01T00:00:00.000Z'), { status: 200, passed: true });
});

test('token sem validade passa', () => {
  assert.deepEqual(call(null), { status: 200, passed: true });
});

test('data de validade ilegível é tratada como vencida (falha fechada)', () => {
  assert.deepEqual(call('não é data'), { status: 401, passed: false });
});
