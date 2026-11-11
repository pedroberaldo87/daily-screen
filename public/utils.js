// Shared HTML escaper. Safe for element content AND for quoted attribute
// values (single, double or unquoted, plus template-literal contexts), so it
// is the only escaper the front-end should use before string-building markup.
// Always coerces to string: numbers interpolated into innerHTML go through it
// too, since API fields are not guaranteed to be numbers.
const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
};

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"'`]/g, (c) => HTML_ESCAPES[c]);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { escapeHtml };
}
