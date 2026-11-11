# Changelog

## Unreleased

### Security

- **All `/api/*` routes now require authentication.** Before, task, item, settings (including the weather location), completed and weather reads, plus task toggle and delete, answered without any credential. They now accept an admin session, an integration Bearer token, or a paired display (see below). Unauthenticated requests get `401`.
- New **display pairing** for the wall tablet: the server validates `DISPLAY_KEY` and sets a long-lived, `HttpOnly`, `SameSite=Strict` cookie. The display cookie can read tasks, settings, completed and weather, toggle a task and answer the recreate prompt. It cannot delete or reach any other route.
- `GET /api/settings` no longer returns `weather_lat` / `weather_lon` unless the caller is the admin session.
- `/api/geocoding` is no longer public.
- The tablet's long-press "remove from routine" gesture is gone (it needed `DELETE`, which the display cannot call). Remove items from the admin panel.
- Removed `docs/security-audit-2026-04-04.md`.
- **Stored XSS hardening in the admin panel and display.** The shared `escapeHtml` now also encodes `"`, `'` and `` ` `` (it used to cover only `& < >`, so a double quote in an item or protocol text field broke out of an HTML attribute). Every interpolated value in `admin.js`, `display.js` and `admin-tokens.js` is escaped, numbers included, and the token list coerces the id used in its inline handlers to a number.
- `total_count` is now validated server-side as an integer 1–100000 or `null`, for items and protocol phases. Item APIs also validate `followup_category`, `followup_icon` length and `active`, with the same rules as protocols. Requests that used to be accepted with other values now get `400`.
- On startup, stored `total_count` values in `phases` and `series` that are not an integer 1–100000 (for example markup saved before this validation) are set to `NULL`. Valid values are untouched.
- **No more inline event handlers; the CSP drops `script-src-attr 'unsafe-inline'`.** The admin and token pages bound their buttons with `onclick=` attributes, which forced the CSP to allow inline handler attributes. Static buttons now carry `data-click="<handler>"` and are bound with `addEventListener`; the per-token revoke/delete buttons use event delegation. `script-src-attr` is now `'none'`, so a future HTML-injection bug can no longer reach script through an `on*=` attribute.
- The display's service-worker registration moved from an inline `<script>` (which `script-src 'self'` blocked) to `public/sw-register.js`, so the tablet's service worker registers again. The service-worker cache name is bumped to `daily-screen-v28` (v27 came with the escaping fix), so tablets fetch the new `display.js` and `sw-register.js`.

### Upgrade notes

1. Add `DISPLAY_KEY` to the server `.env` (at least 32 random characters, e.g. `openssl rand -hex 32`) **before** deploying. Without it, no display can be paired.
2. After deploying, **open the tablet at `https://<your-domain>/?key=<DISPLAY_KEY>` once**. Until then the tablet shows "This display is not paired".
3. Integration clients using `Authorization: Bearer dsk_live_...` keep working unchanged on `/integration/v1/*` and now also on `/api/*`.
