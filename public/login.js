// Login page — one message per outcome of the Google sign-in + i18n init
const params = new URLSearchParams(window.location.search);

const NOTICES = {
  denied: { key: 'login.error.denied', kind: 'is-error' },
  cancelled: { key: 'login.error.cancelled', kind: 'is-error' },
  expired: { key: 'login.error.expired', kind: 'is-error' },
  failed: { key: 'login.error.failed', kind: 'is-error' },
};
const notice = params.has('out')
  ? { key: 'login.loggedOut', kind: 'is-info' }
  : NOTICES[params.get('error')] || null;

function showNotice() {
  if (!notice) return;
  const el = document.getElementById('notice');
  el.textContent = t(notice.key);
  el.className = `notice ${notice.kind}`;
  el.hidden = false;
}

// Fetch settings (public endpoint) so login uses the configured language
fetch('/api/settings')
  .then(r => r.ok ? r.json() : {})
  .catch(() => ({}))
  .then(settings => initI18n(settings))
  .then(showNotice);
