const google = require('../lib/google-oauth');

// True when the request carries a logged-in admin session whose email is still on
// ADMIN_EMAILS. The allowlist is otherwise only read at sign-in, so without this
// re-check a removed admin would keep a 30-day session. A session that no longer
// qualifies (email removed, or authenticated but with no email) is destroyed.
function isAdminSession(req) {
  const sess = req.session;
  if (!sess || !sess.authenticated) return false;
  const email = typeof sess.email === 'string' ? sess.email.trim().toLowerCase() : '';
  if (email && google.allowedEmails().includes(email)) return true;
  sess.destroy((err) => {
    if (err) console.error('[auth] could not destroy a revoked admin session:', err.message);
  });
  return false;
}

function requireAuth(req, res, next) {
  if (isAdminSession(req)) return next();
  res.redirect('/admin/login');
}

// Same guard, but answers JSON 401 (for fetch() calls from the admin panel).
function requireAuthJson(req, res, next) {
  if (isAdminSession(req)) return next();
  res.status(401).json({ error: 'Authentication required' });
}

module.exports = { requireAuth, requireAuthJson, isAdminSession };
