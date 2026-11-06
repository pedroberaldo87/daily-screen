// Google sign-in for the admin panel (OpenID Connect, authorization code flow).
// Endpoints and claims follow https://developers.google.com/identity/openid-connect/openid-connect
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

const REQUIRED_ENV = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'ADMIN_EMAILS'];

// Without these the panel can't log anyone in — fail at boot, like SESSION_SECRET.
function assertConfigured(env = process.env) {
  const missing = REQUIRED_ENV.filter((k) => !String(env[k] || '').trim());
  if (missing.length) throw new Error(`${missing.join(', ')} env var(s) must be set for admin login`);
}

function allowedEmails(env = process.env) {
  return String(env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function buildAuthUrl({ redirectUri, state, nonce }) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    response_type: 'code',
    scope: 'openid email',
    redirect_uri: redirectUri,
    state,
    nonce,
    prompt: 'select_account',
  });
  return `${AUTH_URL}?${params}`;
}

function decodeJwtPayload(jwt) {
  const payload = String(jwt || '').split('.')[1];
  if (!payload) throw new Error('id_token missing or malformed');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

// The id_token comes straight from Google's token endpoint over HTTPS, authenticated by
// our client secret, so Google's docs allow using it without checking its signature.
async function exchangeCode({ code, redirectUri }) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`token endpoint answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  return decodeJwtPayload(body.id_token);
}

// 'invalid' = the token isn't for this login attempt; 'denied' = valid Google account, not allowed.
function checkClaims(claims, { clientId, nonce, allowed, now = Date.now() }) {
  if (!claims || !ISSUERS.includes(claims.iss)) return { ok: false, reason: 'invalid' };
  if (claims.aud !== clientId) return { ok: false, reason: 'invalid' };
  if (!(Number(claims.exp) * 1000 > now)) return { ok: false, reason: 'invalid' };
  if (!nonce || claims.nonce !== nonce) return { ok: false, reason: 'invalid' };
  const email = String(claims.email || '').toLowerCase();
  if (claims.email_verified !== true || !allowed.includes(email)) return { ok: false, reason: 'denied' };
  return { ok: true, email };
}

module.exports = { assertConfigured, allowedEmails, buildAuthUrl, exchangeCode, checkClaims, decodeJwtPayload };
