// ═══════════════════════════════════════════════
// i18n — Lightweight translation module
// ═══════════════════════════════════════════════

const SUPPORTED_LANGS = ['pt-BR', 'en', 'es'];
const DEFAULT_LANG = 'pt-BR';

let _currentLang = DEFAULT_LANG;
let _translations = {};
let _fallback = {};

// Language detection: map navigator.language to supported lang
const LANG_MAP = {
  'pt-BR': 'pt-BR', 'pt': 'pt-BR',
  'en-US': 'en', 'en-GB': 'en', 'en': 'en',
  'es-AR': 'es', 'es-ES': 'es', 'es-MX': 'es', 'es': 'es',
};

function detectLang() {
  const nav = navigator.language || navigator.userLanguage || '';
  return LANG_MAP[nav] || LANG_MAP[nav.split('-')[0]] || DEFAULT_LANG;
}

async function loadLangFile(lang) {
  const res = await fetch(`/public/lang/${lang}.json`);
  if (!res.ok) throw new Error(`Failed to load /public/lang/${lang}.json`);
  return res.json();
}

async function initI18n(settings) {
  const settingLang = settings && settings.language;
  _currentLang = (settingLang && SUPPORTED_LANGS.includes(settingLang))
    ? settingLang
    : detectLang();

  try {
    _translations = await loadLangFile(_currentLang);
  } catch {
    _translations = {};
    _currentLang = DEFAULT_LANG;
  }

  // Load fallback if current != default
  if (_currentLang !== DEFAULT_LANG) {
    try { _fallback = await loadLangFile(DEFAULT_LANG); } catch { _fallback = {}; }
  } else {
    _fallback = _translations;
  }

  applyTranslations();
}

function t(key, params) {
  let str = _translations[key] || _fallback[key] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    }
  }
  return str;
}

function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  });
}

async function setLanguage(lang) {
  if (!SUPPORTED_LANGS.includes(lang)) return;
  _currentLang = lang;
  try {
    _translations = await loadLangFile(lang);
  } catch {
    _translations = {};
    _currentLang = DEFAULT_LANG;
  }
  if (_currentLang !== DEFAULT_LANG && Object.keys(_fallback).length === 0) {
    try { _fallback = await loadLangFile(DEFAULT_LANG); } catch { _fallback = {}; }
  }
  applyTranslations();
}

function getLang() {
  return _currentLang;
}

function getLocale() {
  return _translations._locale || 'pt-BR';
}

function getDateFormat() {
  return _translations._dateFormat || '{weekday}, {day} de {month}';
}
