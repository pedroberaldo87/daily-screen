# Changelog

## Unreleased

### Security

- **All `/api/*` routes now require authentication.** Before, task, item, settings (including the weather location), completed and weather reads, plus task toggle and delete, answered without any credential. They now accept an admin session, an integration Bearer token, or a paired display (see below). Unauthenticated requests get `401`.
- New **display pairing** for the wall tablet: the server validates `DISPLAY_KEY` and sets a long-lived, `HttpOnly`, `SameSite=Strict` cookie. The display cookie can read tasks, settings, completed and weather, toggle a task and answer the recreate prompt. It cannot delete or reach any other route.
- `GET /api/settings` no longer returns `weather_lat` / `weather_lon` unless the caller is the admin session.
- `/api/geocoding` is no longer public.
- The tablet's long-press "remove from routine" gesture is gone (it needed `DELETE`, which the display cannot call). Remove items from the admin panel.
- Removed `docs/security-audit-2026-04-04.md`.
- `deploy.sh` now builds the image locally and ships it to the server (the shared VPS never builds).
- `deploy.sh` verifies the server's SSH host key (`StrictHostKeyChecking=yes`, file set by `DEPLOY_KNOWN_HOSTS`, default `~/.ssh/known_hosts`). **Pin the host key once before the next deploy**; see "Pin the server host key" in the README.
- `deploy.sh` stages the upload and the `docker/.env` backup in a private `mktemp -d` directory on the server (mode 700) instead of fixed `/tmp` paths, fails if the backup cannot be written, and removes the directory on every exit path.
- `.dockerignore` now excludes `.env` files in any directory (`**/.env`), so `docker/.env` can no longer be copied into an image.

### Upgrade notes

1. Add `DISPLAY_KEY` to the server `.env` (at least 32 random characters, e.g. `openssl rand -hex 32`) **before** deploying. Without it, no display can be paired.
2. After deploying, **open the tablet at `https://<your-domain>/?key=<DISPLAY_KEY>` once**. Until then the tablet shows "This display is not paired".
3. Integration clients using `Authorization: Bearer dsk_live_...` keep working unchanged on `/integration/v1/*` and now also on `/api/*`.
