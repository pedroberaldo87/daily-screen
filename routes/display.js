const { Router } = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');
const {
  isAdminSession,
  hasDisplayCookie,
  keyMatches,
  setDisplayCookie,
} = require('../middleware/api-auth');

const router = Router();

// Counts only wrong/missing-credential answers, so guessing the key is throttled
// while a paired tablet is never affected.
const pairFailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  requestWasSuccessful: (req, res) => res.statusCode !== 401,
  message: 'Too many attempts',
});

const MESSAGES = {
  en: { lang: 'en', title: 'This display is not paired', body: 'Open the pairing link once on this device to connect it.' },
  'pt-BR': { lang: 'pt-BR', title: 'Este painel não está pareado', body: 'Abra o link de pareamento uma vez neste aparelho para conectá-lo.' },
  es: { lang: 'es', title: 'Esta pantalla no está emparejada', body: 'Abre el enlace de emparejamiento una vez en este dispositivo para conectarla.' },
};

// Same three languages as the app. The page is static HTML (no script), so the
// language comes from Accept-Language rather than the (protected) settings.
function pickMessage(req) {
  const header = (req.get('accept-language') || '').toLowerCase();
  for (const part of header.split(',')) {
    const tag = part.split(';')[0].trim();
    if (tag.startsWith('pt')) return MESSAGES['pt-BR'];
    if (tag.startsWith('es')) return MESSAGES.es;
    if (tag.startsWith('en')) return MESSAGES.en;
  }
  return MESSAGES['pt-BR']; // app default language
}

function sendUnpaired(req, res) {
  const m = pickMessage(req);
  res
    .status(401)
    .set('Cache-Control', 'no-store')
    .type('html')
    .send(`<!DOCTYPE html>
<html lang="${m.lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily Screen</title>
  <style>
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
           background: #0c0a0f; color: #f0ece4; font-family: system-ui, sans-serif; text-align: center; padding: 24px; }
    h1 { font-size: 1.6rem; font-weight: 600; margin: 0 0 12px; }
    p { color: #7d7889; margin: 0; }
  </style>
</head>
<body>
  <main>
    <h1>${m.title}</h1>
    <p>${m.body}</p>
  </main>
</body>
</html>
`);
}

router.get('/', pairFailLimiter, (req, res) => {
  // One-time pairing: /?key=<DISPLAY_KEY> sets the cookie and moves to the clean URL.
  if (req.query.key !== undefined) {
    if (!keyMatches(req.query.key)) return sendUnpaired(req, res);
    setDisplayCookie(req, res);
    res.set('Cache-Control', 'no-store');
    return res.redirect(302, '/');
  }

  if (!isAdminSession(req) && !hasDisplayCookie(req)) return sendUnpaired(req, res);

  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, '..', 'views', 'display.html'));
});

module.exports = router;
