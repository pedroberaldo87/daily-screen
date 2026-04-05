// Login page — error display + i18n init
const params = new URLSearchParams(window.location.search);
if (params.get('error')) {
  const el = document.getElementById('error');
  el.textContent = 'Senha incorreta';
  el.style.display = 'block';
}

// Fetch settings (public endpoint) so login uses the configured language
fetch('/api/settings')
  .then(r => r.ok ? r.json() : {})
  .catch(() => ({}))
  .then(settings => initI18n(settings))
  .then(() => {
    if (params.get('error')) {
      document.getElementById('error').textContent = t('login.error');
    }
  });
