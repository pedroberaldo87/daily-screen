const test = require('node:test');
const assert = require('node:assert/strict');
const { assertConfigured, allowedEmails, buildAuthUrl, checkClaims, decodeJwtPayload } = require('../lib/google-oauth');

const NOW = Date.parse('2026-11-06T12:00:00Z');
const opts = { clientId: 'cid.apps.googleusercontent.com', nonce: 'n1', allowed: ['dono@gmail.com'], now: NOW };
const good = {
  iss: 'https://accounts.google.com',
  aud: 'cid.apps.googleusercontent.com',
  exp: NOW / 1000 + 3600,
  nonce: 'n1',
  email: 'Dono@Gmail.com',
  email_verified: true,
};

test('conta autorizada com token válido entra', () => {
  assert.deepEqual(checkClaims(good, opts), { ok: true, email: 'dono@gmail.com' });
});

test('emissor sem https também é aceito (os dois valores que o Google documenta)', () => {
  assert.equal(checkClaims({ ...good, iss: 'accounts.google.com' }, opts).ok, true);
});

test('conta Google fora da lista é recusada como "sem acesso"', () => {
  assert.deepEqual(checkClaims({ ...good, email: 'outro@gmail.com' }, opts), { ok: false, reason: 'denied' });
});

test('e-mail não verificado é recusado como "sem acesso"', () => {
  assert.deepEqual(checkClaims({ ...good, email_verified: false }, opts), { ok: false, reason: 'denied' });
});

test('token de outro app, vencido, de outro emissor ou de outra tentativa é inválido', () => {
  for (const bad of [
    { aud: 'outro-app' },
    { exp: NOW / 1000 - 1 },
    { iss: 'https://evil.example' },
    { nonce: 'outra-tentativa' },
    { nonce: undefined },
  ]) {
    assert.deepEqual(checkClaims({ ...good, ...bad }, opts), { ok: false, reason: 'invalid' }, JSON.stringify(bad));
  }
  assert.deepEqual(checkClaims(good, { ...opts, nonce: undefined }), { ok: false, reason: 'invalid' });
  assert.deepEqual(checkClaims(null, opts), { ok: false, reason: 'invalid' });
});

test('boot recusa subir sem as variáveis do login', () => {
  assert.throws(() => assertConfigured({}), /GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ADMIN_EMAILS/);
  assert.throws(() => assertConfigured({ GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b', ADMIN_EMAILS: '  ' }), /ADMIN_EMAILS/);
  assert.doesNotThrow(() => assertConfigured({ GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b', ADMIN_EMAILS: 'x@y.z' }));
});

test('lista de e-mails aceita vírgula, espaço e maiúscula', () => {
  assert.deepEqual(allowedEmails({ ADMIN_EMAILS: ' A@x.com, b@y.com ,,' }), ['a@x.com', 'b@y.com']);
});

test('link para o Google leva os parâmetros do fluxo', () => {
  process.env.GOOGLE_CLIENT_ID = 'cid';
  const url = new URL(buildAuthUrl({ redirectUri: 'https://h/admin/auth/google/callback', state: 's', nonce: 'n' }));
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('client_id'), 'cid');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('scope'), 'openid email');
  assert.equal(url.searchParams.get('state'), 's');
  assert.equal(url.searchParams.get('nonce'), 'n');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://h/admin/auth/google/callback');
});

test('lê o conteúdo do id_token', () => {
  const jwt = ['h', Buffer.from(JSON.stringify({ email: 'a@b.c' })).toString('base64url'), 'sig'].join('.');
  assert.deepEqual(decodeJwtPayload(jwt), { email: 'a@b.c' });
  assert.throws(() => decodeJwtPayload(undefined), /malformed/);
});
