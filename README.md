# Daily Screen

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL%203.0-blue.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-green.svg)]()
[![Docker](https://img.shields.io/badge/Docker-Alpine-blue.svg)]()

## What is Daily Screen?

An ADHD morning assistant designed for wall-mounted tablets (Fire HD 8, 1280×800 landscape). Displays a daily checklist of medications, supplements, and reminders with progress tracking. Includes a web admin panel to manage items, real-time weather forecast, and intelligent date navigation with auto-reset on idle.

<!-- screenshot placeholder: display view with 4-panel layout (clock, weather, checklist, progress) + date navigation -->
<!-- screenshot placeholder: admin panel with item CRUD and settings -->

## Features

- **Daily checklist** — medications, supplements, reminders with emoji icons
- **Progress tracking** — visual completion percentage
- **Weather forecast** — Open-Meteo integration (free, no API key)
- **Date navigation** — browse past/future days, auto-reset to today after 5 min idle
- **Admin panel** — password-protected item management and settings
- **Responsive design** — optimized for 1280×800, works on other sizes
- **Configurable** — font sizes, colors, weekday scheduling per item
- **Follow-up tasks** — auto-generate follow-up reminders
- **PWA with offline support** — service worker for network interruptions
- **No build step** — vanilla HTML/CSS/JS, runs directly in Node.js

## Quick Start

### Local Development

Requires Node.js 20+ and npm.

```bash
git clone https://github.com/pedroberaldo87/daily-screen.git
cd daily-screen

# Install dependencies
npm install

# Create .env from template
cp .env.example .env

# Edit .env with your values (at minimum, change ADMIN_PASSWORD)
nano .env

# Run development server
node --watch server.js
```

Open http://localhost:3000 in your browser. Admin panel at http://localhost:3000/admin (login with password from `.env`).

### Docker

Requires Docker and Docker Compose.

```bash
git clone https://github.com/pedroberaldo87/daily-screen.git
cd daily-screen

# Create shared Docker network (required for Caddy reverse proxy)
docker network create shared_web

# Create .env from template
cp docker/.env.example docker/.env

# Edit docker/.env with your values
nano docker/.env

# Start containers
docker compose up -d

# View logs
docker compose logs -f daily-screen-app
```

The app runs on port 3000 (internal). To expose via HTTPS, use Caddy or your preferred reverse proxy.

## Deploy to VPS

The project includes a parametrized deploy script that builds, uploads, and starts the app on a remote server.

```bash
DEPLOY_HOST=your-vps-ip DEPLOY_KEY=~/.ssh/your_key ./deploy.sh
```

**Environment variables:**
- **DEPLOY_HOST** (required) — VPS IP or hostname
- **DEPLOY_KEY** (required) — path to SSH private key
- **DEPLOY_USER** (optional, default: `root`)
- **DEPLOY_PATH** (optional, default: `/opt/daily-screen`)

The script:
1. Creates a local tarball (excludes `node_modules`, `.db`, `.git`, `.env`)
2. Uploads to `/tmp/daily-screen-deploy.tar.gz`
3. Prunes Docker to free space
4. Backs up production `.env`
5. Extracts tarball, restores `.env`
6. Builds and runs containers
7. Verifies container health
8. Cleans up temporary files

If `.env` doesn't exist on first deploy, create it manually on the VPS at the deploy path.

## Environment Variables

- **PORT** — Express server port (default: `3000`)
- **ADMIN_PASSWORD** — Password for admin panel login. Change this to a strong value in production.
- **SESSION_SECRET** — Secret key for session cookies. Use a random string.
- **DATABASE_PATH** — Path to SQLite database (default: `./daily-screen.db` for dev, `/data/daily-screen.db` for Docker)
- **WEATHER_LAT** — Default latitude for weather forecast (default: `-23.55`)
- **WEATHER_LON** — Default longitude for weather forecast (default: `-46.63`)
- **WEATHER_TZ** — Timezone for weather display (default: `America/Sao_Paulo`)

See **docker/.env.example** for production defaults.

## Architecture

Daily Screen follows a simple server-rendered architecture with no build step.

**Backend** — Express server handles:
- REST API for tasks, items, weather, settings
- Session-based admin authentication
- SQLite database with automatic migrations

**Frontend** — Vanilla HTML/CSS/JavaScript:
- **display.html** — tablet view (4-panel layout: clock, weather, checklist, progress)
- **admin.html** — admin panel (CRUD, settings, emoji picker)
- **sw.js** — service worker for offline support and cache management

**Database** — SQLite with WAL mode:
- `routine_items` — template tasks (title, icon, category, weekday schedule, alerts)
- `daily_tasks` — daily instances (lazy-generated from routine_items)
- `settings` — key-value store (location, fonts, timezone)
- `sessions` — admin session tokens

### Directory Structure

```
daily-screen/
  server.js              # Express entry point
  db.js                  # SQLite schema, queries, migrations
  weather.js             # Open-Meteo fetch + 30min cache
  session-store.js       # Custom SQLite session store
  Dockerfile             # Multi-stage Node 20 Alpine
  deploy.sh              # VPS deploy script
  docker/
    docker-compose.yml   # Container orchestration
    .env.example         # Production env template
  routes/
    display.js           # GET / → tablet display
    admin.js             # POST /admin/login, GET /admin
    api.js               # REST API endpoints
  middleware/
    auth.js              # Session authentication
  public/
    style.css            # Design system (Ember Night palette)
    display.js           # Tablet display logic (clock, weather, tasks, date nav)
    admin.js             # Admin panel logic (CRUD, settings)
    icon-picker.js       # Emoji picker with PT-BR search
    utils.js             # Shared utilities (escapeHtml)
    sw.js                # Service worker (offline + cache strategies)
    manifest.json        # PWA manifest
  views/
    display.html         # Tablet UI
    admin.html           # Admin panel UI
    login.html           # Login page
```

### Key Patterns

**Lazy task generation** — daily_tasks are created on-demand when you call `GET /api/tasks?date=YYYY-MM-DD`. If tasks exist for that date, they're returned; otherwise, they're generated from `routine_items` matching the date's weekday.

**CSS custom properties** — Font sizes are stored in the database and applied as CSS variables. Admin can adjust `--fs-clock`, `--fs-greeting`, etc. in real-time.

**Emoji icons** — Tasks use Unicode emoji stored as text in SQLite. The emoji picker provides searchable selection with Portuguese-Brazilian keywords.

**Service worker** — Uses cache-first strategy for shell assets (HTML, CSS, JS) and network-first for API calls. After deploy, bump `CACHE_NAME` in **public/sw.js** to force browser cache refresh.

## API Endpoints

All endpoints are prefixed with `/api`.

**Public (no auth required):**
- `GET /api/tasks?date=YYYY-MM-DD` — Get tasks for date (lazy-generates if needed)
- `POST /api/tasks/:id/toggle` — Mark/unmark task as complete
- `GET /api/items` — List all routine items
- `GET /api/weather` — Weather forecast (cached 30 min)
- `GET /api/geocoding?q=cidade` — Search cities (Open-Meteo)
- `GET /api/settings` — Get all settings

**Auth required (admin session):**
- `POST /api/items` — Create routine item
- `PUT /api/items/:id` — Update routine item
- `DELETE /api/items/:id` — Soft delete (deactivate)
- `DELETE /api/items/:id/permanent` — Hard delete
- `PUT /api/settings` — Update settings (key-value pairs)

## Contributing

Found a bug? Have a feature idea? Contributions are welcome.

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Test locally
5. Commit and push
6. Open a pull request

Please follow the existing code style (CommonJS imports, no TypeScript, vanilla JS). For major changes, open an issue first to discuss.

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the [GNU General Public License v3.0](LICENSE). See LICENSE file for details.

---

**Built for ADHD morning routines. Works offline. No tracking. Open source.**
