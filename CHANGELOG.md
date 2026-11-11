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
- The service worker cache is now `daily-screen-v27`, so installed tablets fetch the fixed `display.js` instead of serving the old one from cache.
- **Input and session hardening.**
  - `GET /integration/v1/history`, `/adherence` and `/adherence/summary`: `date_from` / `date_to` must be real calendar days, span at most 3660 days (the same cap as `days`) and end at most 366 days after today. Wider windows used to loop over millions of days and write one row per day per series. They now get `400`.
  - `GET /api/tasks?date=` and `GET /integration/v1/tasks?date=` require a real `YYYY-MM-DD` day close to today before generating that day's rows: the paired display ±31 days, admin session and Bearer token ±366 days. Anything else gets `400`. Repeated `date` parameters get `400` too.
  - `weather_tz` is checked against the runtime's IANA zone list when saved (`Foo/Bar` used to pass and then made every date lookup throw, including at startup). `todayDate()` now falls back to `WEATHER_TZ` / `America/Sao_Paulo` when a stored zone is invalid, so an instance that already holds a bad value starts again. The weather lookup and `/integration/v1/health` use the same fallback, and the shape check no longer rejects real zones such as `America/Port-au-Prince` or `Etc/GMT+3`. The display's day arrows stop at +/-31 days, the window the server accepts.
  - Pre-login Google sign-in sessions live 10 minutes (row and cookie) instead of 30 days, and `GET /admin/auth/google` is limited to 20 requests per IP per 15 minutes (`429`). The session issued after a successful login keeps its 30 days. Opening the sign-in URL while already signed in no longer touches the existing session (it redirects to `/admin`).
  - Admin sessions are checked against `ADMIN_EMAILS` on every request, not only at sign-in. Removing an address ends that admin's session on the next request after the server restarts with the new value; sessions with no stored email are also refused (sign in again).
  - Retrying `POST /integration/v1/items` or `/protocols` with the same `Idempotency-Key` and an array `weekdays` / `periods` replays the first response instead of answering `409`.

### Upgrade notes

1. Add `DISPLAY_KEY` to the server `.env` (at least 32 random characters, e.g. `openssl rand -hex 32`) **before** deploying. Without it, no display can be paired.
2. After deploying, **open the tablet at `https://<your-domain>/?key=<DISPLAY_KEY>` once**. Until then the tablet shows "This display is not paired".
3. Integration clients using `Authorization: Bearer dsk_live_...` keep working unchanged on `/integration/v1/*` and now also on `/api/*`.
