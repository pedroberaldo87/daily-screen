# Daily Screen — Integration API Guide

**Version:** 1.0
**Date:** 2026-04-20
**Base URL:** `https://daily.aiworks.app.br/integration/v1`
**Audience:** External agents (e.g., Claude Code instances, scripts, cron jobs) that need programmatic CRUD access to items, protocols, daily tasks, and settings.

---

## 1. Overview

Daily Screen is a wall-mounted daily assistant showing a checklist of medications, supplements, and reminders. The web admin manages **items** (templates) and **protocols** (dated multi-phase sequences, e.g. dose-tapering). Every day, the app lazily generates **tasks** (daily instances) from items.

The **Integration API** is a parallel, token-authenticated surface at `/integration/v1/*` that mirrors the admin's CRUD capabilities. An external agent holding a bearer token can:

- List/create/update/delete **items**
- List/create/update/delete **protocols** (with phases)
- Read/toggle **daily tasks**
- Read/update **settings** (weather location, fonts, periods, language)
- Read **weather** (read-only passthrough)
- Convert a standalone item into the first phase of a new protocol

### Mental model

```
Protocol (e.g. "Ritalina taper")
  ├─ Phase 1 (routine_item) — 1 tablet/day, days 1–30
  ├─ Phase 2 (routine_item) — 0.5 tablet/day, days 31–45
  └─ Phase 3 (routine_item) — 0 tablet/day, days 46+

Standalone Item (routine_item, no protocol)
  └─ generates one daily_task per active day, until total_count reached

Daily Task (daily_tasks row)
  ├─ references routine_item_id
  ├─ has date (YYYY-MM-DD)
  └─ completed flag + timestamp
```

Phases are stored as `routine_items` rows with a `protocol_id` FK. The public item listing (`GET /items`) excludes them — manage them through protocol endpoints.

---

## 2. Quickstart

### Step 1 — Create a token
Log into the admin panel and navigate to **Tokens** (top nav). Click **Novo token**, give it a descriptive name (e.g. `claude-code-laptop`), and copy the plaintext value that appears **once**. Store it somewhere safe — if you lose it, create a new one.

### Step 2 — Hello, world
```bash
export DS_TOKEN="dsk_live_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
curl -H "Authorization: Bearer $DS_TOKEN" \
  https://daily.aiworks.app.br/integration/v1/health
```
Expected:
```json
{
  "ok": true,
  "version": "1.0.0",
  "now": "2026-04-20T14:32:00.000Z",
  "tz": "America/Sao_Paulo",
  "today": "2026-04-20",
  "token": { "prefix": "dsk_live_Abc", "name": "claude-code-laptop" }
}
```

### Step 3 — Fetch today's items
```bash
curl -H "Authorization: Bearer $DS_TOKEN" \
  https://daily.aiworks.app.br/integration/v1/items
```

---

## 3. Authentication

### Token format
Tokens start with a fixed prefix `dsk_live_` followed by 43 base64url characters (256 bits entropy). Example:

```
dsk_live_XKxOVTHyu7BJEMN_ytYZ7UfY1YSc8hTqiT7QuXgrRgo
```

### Authorization header
Send the token in the `Authorization` header with `Bearer` scheme:

```
Authorization: Bearer dsk_live_XKxOVTHyu7BJEMN_ytYZ7UfY1YSc8hTqiT7QuXgrRgo
```

### Storage
The server only stores a SHA-256 hash of the token plus the first 12 characters (for display in the admin UI). The plaintext is shown **once on creation and never again**. If lost, revoke and recreate.

### Auth failures
| Status | Body | Meaning |
|--------|------|---------|
| 401 | `{"error":"Token required"}` | Missing or malformed `Authorization` header |
| 401 | `{"error":"Invalid token"}` | Token doesn't exist |
| 401 | `{"error":"Token revoked"}` | Admin revoked this token |
| 401 | `{"error":"Token expired"}` | Token's `expires_at` has passed |

---

## 4. Base URL & Versioning

**Production:** `https://daily.aiworks.app.br/integration/v1`
**Dev (localhost):** `http://localhost:3000/integration/v1`

The path contains `v1`. Breaking changes will go to `v2` under a new prefix; `v1` will keep working until officially deprecated.

---

## 5. Rate Limits

| Limit | Window | Applies to |
|-------|--------|------------|
| 120 requests / min | 60s | Per token |
| 60 failed requests / 15 min | 15 min | Per IP (brute-force protection) |

Responses include IETF-standard `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` headers. When exceeded:

```
HTTP/1.1 429 Too Many Requests
Content-Type: application/json

{"error":"Rate limit exceeded"}
```

Back off respecting `RateLimit-Reset` (seconds until the window resets).

---

## 6. Error Format

All errors return a JSON object with a single `error` field:

```json
{ "error": "title is required; category must be one of: medication, supplement, reminder" }
```

Multiple validation errors are joined with `; `.

### Status codes

| Code | When |
|------|------|
| 200 | Success |
| 201 | Resource created |
| 400 | Validation error |
| 401 | Missing/invalid/revoked/expired token |
| 404 | Resource not found |
| 409 | Conflict (e.g. convert-to-protocol on an item that's already a phase) |
| 429 | Rate limit exceeded |
| 503 | External service unavailable (weather, geocoding) |

---

## 7. Data Models

### Item (`routine_items`)
A template for a repeating task. The field set supports dose counters, per-weekday and per-period filtering, alerts, and follow-up replacement.

```typescript
type Item = {
  id: number;
  title: string;                      // max 200 chars, required
  category: "medication" | "supplement" | "reminder";
  icon: string;                       // emoji, max 10 chars, default "✅"
  sort_order: number;                 // -1000..1000, default 0
  active: 0 | 1;                      // 1 = visible, 0 = soft-deleted
  weekdays: string;                   // JSON array [0..6], 0=Sun, e.g. "[1,2,3,4,5]"
  periods: string;                    // JSON array of "morning"|"afternoon"|"night", [] = day-long
  total_count: number | null;         // if set, item becomes a counter
  completed_count: number;            // counter progress, updated by toggleTask
  alert_penultimate: string | null;   // shown at total_count - 1
  alert_last: string | null;          // shown at total_count (triggers followup)
  followup_title: string | null;      // title of replacement item when counter reaches max
  followup_category: string | null;
  followup_icon: string | null;
  protocol_id: number | null;         // non-null = phase of a protocol (not returned by GET /items)
  phase_order: number | null;         // 1-based ordinal within protocol
  start_date: string | null;          // "YYYY-MM-DD", inclusive lower bound of visibility window
  end_date: string | null;            // "YYYY-MM-DD", inclusive upper bound
  created_at: string;                 // SQLite datetime
};
```

### Protocol (`protocols`)
A named sequence of dated phases. Each phase is a routine_item with `protocol_id` set.

```typescript
type Protocol = {
  id: number;
  name: string;                       // max 200 chars, required
  start_date: string;                 // "YYYY-MM-DD", required
  repeat_indefinitely: 0 | 1;         // if 1, last phase repeats forever
  active: 0 | 1;
  created_at: string;
  phases: Phase[];                    // embedded, ordered by phase_order
};

type Phase = Item & {
  duration_days: number;              // 1..3650
  // start_date and end_date of each phase are auto-calculated
  // from protocol.start_date + cumulative duration_days.
};
```

### Daily Task (`daily_tasks`, joined with item)
A per-date instance of an item.

```typescript
type DailyTask = {
  id: number;                         // daily_tasks.id
  routine_item_id: number;
  date: string;                       // "YYYY-MM-DD" in weather_tz
  completed: 0 | 1;
  completed_at: string | null;        // SQLite datetime
  // …plus all item fields (title, category, icon, etc.) joined in
};
```

### Settings
Key-value store. Keys are whitelisted.

| Key | Value | Notes |
|-----|-------|-------|
| `weather_lat` | string (number) | -90..90 |
| `weather_lon` | string (number) | -180..180 |
| `weather_tz` | IANA timezone | e.g. `America/Sao_Paulo` |
| `weather_city` | display string | free text |
| `language` | `"pt-BR"` \| `"en"` \| `"es"` | |
| `period_display_mode` | `"words"` \| `"icons"` \| `"both"` | |
| `period_morning_start` | HH:MM | < afternoon |
| `period_afternoon_start` | HH:MM | < night |
| `period_night_start` | HH:MM | |
| `font_clock`, `font_greeting`, `font_date`, `font_weather_temp`, `font_task_title`, `font_col_header`, `font_task_icon`, `font_progress`, `font_task_count` | CSS size | e.g. `"3rem"`, `"48px"` |

---

## 8. Endpoint Reference

All endpoints require `Authorization: Bearer <token>`. All responses are JSON.

### Health

#### `GET /health`
Returns server info + echoes the token identity.

```json
{
  "ok": true,
  "version": "1.0.0",
  "now": "2026-04-20T14:32:00.000Z",
  "tz": "America/Sao_Paulo",
  "today": "2026-04-20",
  "token": { "prefix": "dsk_live_Abc", "name": "claude-code-laptop" }
}
```

---

### Tasks

#### `GET /tasks?date=YYYY-MM-DD`
Returns all daily tasks for the given date (default: today in `weather_tz`). Lazy-generates missing tasks from active items that match the weekday + date window.

**Query:**
- `date` (optional) — `YYYY-MM-DD`; defaults to today

**Response 200:**
```json
[
  {
    "id": 123,
    "routine_item_id": 22,
    "date": "2026-04-20",
    "completed": 0,
    "completed_at": null,
    "title": "Tomar Ritalina",
    "category": "medication",
    "icon": "💊",
    "periods": "[\"morning\"]",
    "weekdays": "[0,1,2,3,4,5,6]",
    "...": "plus all other item fields"
  }
]
```

**Errors:** `400` if date format is wrong.

**Example:**
```bash
curl -H "Authorization: Bearer $DS_TOKEN" \
  "https://daily.aiworks.app.br/integration/v1/tasks?date=2026-04-20"
```

#### `POST /tasks/:id/toggle`
Toggles the `completed` flag on a single daily task. Returns the updated task. If the task's item has a `total_count` and it was just reached, the followup mechanism triggers server-side (creates a replacement item with the followup fields).

**Response 200:** the updated task object.
**Errors:** `404` if task id doesn't exist.

**Example:**
```bash
curl -X POST -H "Authorization: Bearer $DS_TOKEN" \
  https://daily.aiworks.app.br/integration/v1/tasks/123/toggle
```

---

### Items

#### `GET /items`
Returns all standalone routine_items (both active and inactive), sorted by active DESC, sort_order, id. **Excludes protocol phases** — manage those via protocol endpoints.

**Example:**
```bash
curl -H "Authorization: Bearer $DS_TOKEN" \
  https://daily.aiworks.app.br/integration/v1/items
```

#### `POST /items`
Creates a new standalone item. Body follows the `Item` type; required fields: `title`, `category`.

**Body (minimum):**
```json
{ "title": "Vitamina D", "category": "supplement", "icon": "☀️" }
```

**Body (full):**
```json
{
  "title": "Magnésio",
  "category": "supplement",
  "icon": "🌙",
  "sort_order": 10,
  "weekdays": [1,2,3,4,5],
  "periods": ["night"],
  "total_count": 30,
  "alert_penultimate": "Penúltimo!",
  "alert_last": "Último — lembrar de comprar",
  "followup_title": "Comprar Magnésio",
  "followup_category": "reminder",
  "followup_icon": "🛒",
  "start_date": "2026-04-20",
  "end_date": "2026-06-20"
}
```

**Response 201:** `{ "id": 42 }`

**Errors:** `400` if validation fails.

**Node.js example:**
```js
const res = await fetch('https://daily.aiworks.app.br/integration/v1/items', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.DS_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    title: 'Vitamina D',
    category: 'supplement',
    icon: '☀️',
  }),
});
const { id } = await res.json();
```

#### `PUT /items/:id`
Partial update — send only the fields you want to change. Empty string or `null` for `start_date`/`end_date` clears the window.

**Response 200:** the updated item object.
**Errors:** `400` validation, `404` not found.

#### `DELETE /items/:id`
**Soft delete** (sets `active = 0`). Historical daily_tasks are preserved.

**Response 200:** `{ "ok": true }`

#### `DELETE /items/:id/permanent`
**Hard delete** — removes the item AND its daily_tasks via CASCADE. Use only if you really want the history gone.

**Response 200:** `{ "ok": true }`

#### `POST /items/:id/convert-to-protocol`
Converts a standalone item into the first phase of a brand-new protocol. **Preserves the original item id**, so existing daily_tasks stay linked (no history loss).

**Body (all optional):**
```json
{
  "name": "Ritalina taper",
  "first_phase_duration": 30,
  "second_phase_duration": 15,
  "repeat_indefinitely": false
}
```
If omitted, defaults apply (see `db.js#convertItemToProtocol`).

**Response 201:** the full protocol object (with phases).
**Errors:** `404` item not found, `409` item is already a phase.

---

### Protocols

#### `GET /protocols`
Returns all protocols with their phases embedded, sorted by active DESC, id DESC.

**Example response:**
```json
[
  {
    "id": 3,
    "name": "Ritalina taper",
    "start_date": "2026-04-01",
    "repeat_indefinitely": 0,
    "active": 1,
    "created_at": "2026-04-01 10:00:00",
    "phases": [
      { "id": 22, "phase_order": 1, "title": "Ritalina 10mg", "duration_days": 30, "...": "..." },
      { "id": 23, "phase_order": 2, "title": "Ritalina 5mg",  "duration_days": 15, "...": "..." }
    ]
  }
]
```

#### `GET /protocols/:id`
Single protocol with phases.
**Errors:** `404` not found.

#### `POST /protocols`
Creates a protocol with phases in one call. Phase dates (`start_date`, `end_date`) are auto-calculated from `protocol.start_date` + cumulative `duration_days`.

**Body:**
```json
{
  "name": "Ritalina taper",
  "start_date": "2026-05-01",
  "repeat_indefinitely": false,
  "phases": [
    {
      "title": "Ritalina 10mg",
      "category": "medication",
      "icon": "💊",
      "periods": ["morning"],
      "duration_days": 30
    },
    {
      "title": "Ritalina 5mg",
      "category": "medication",
      "icon": "💊",
      "periods": ["morning"],
      "duration_days": 15
    }
  ]
}
```

**Response 201:** the created protocol (full object with computed phase dates).
**Errors:** `400` validation (`phases` must have 1–20 items, each with `duration_days` 1–3650 and valid item fields).

#### `PUT /protocols/:id`
Update metadata, OR replace phases.
- If the body contains no `phases` array → only metadata (name, start_date, repeat_indefinitely) is updated.
- If `phases` is present → **destructive**: all existing phases are DELETEd and new ones INSERTed. Daily_tasks of old phases are CASCADE-deleted. History of completion for those phases is LOST.

**Prefer** omitting `phases` unless you're restructuring the protocol.

#### `DELETE /protocols/:id`
Deletes the protocol. CASCADE removes all phase items AND their daily_tasks.

**Response 200:** `{ "ok": true }`

---

### Settings

#### `GET /settings`
Returns all settings as a flat key-value object.

```json
{
  "language": "pt-BR",
  "weather_lat": "-23.55",
  "weather_lon": "-46.63",
  "weather_tz": "America/Sao_Paulo",
  "period_morning_start": "05:00",
  "period_afternoon_start": "12:00",
  "period_night_start": "18:00",
  "...": "..."
}
```

#### `PUT /settings`
Batch-update settings. Body is a flat object; unknown keys are rejected. Values must be strings or numbers (stored as strings).

**Cross-field validation:** if any of `period_morning_start`, `period_afternoon_start`, `period_night_start` is in the body, the server merges it with stored values and validates chronological order `morning < afternoon < night`. Partial updates are OK as long as the resulting state is valid.

**Body:**
```json
{
  "weather_tz": "Europe/Berlin",
  "language": "en",
  "period_morning_start": "06:00"
}
```

**Response 200:** the full settings object (post-update).
**Errors:** `400` if any key is unknown, value is out of range, or chronology is violated.

---

### Weather

#### `GET /weather`
Read-only passthrough of the Open-Meteo forecast, cached server-side (30 min). Uses `weather_lat`/`weather_lon`/`weather_tz` from settings.

**Response 200:** forecast payload (see Open-Meteo docs) with an extra `cityName` field from `weather_city` setting.
**Errors:** `503` if Open-Meteo is unavailable.

---

## 9. Gotchas & Domain Knowledge

Stuff that's not obvious from the schema but will bite you:

### 9.1. Dates are in `weather_tz`, not UTC
"Today" on this app means today in the timezone configured under `weather_tz`. If `weather_tz` is `America/Sao_Paulo` and UTC is 03:00 but local time is 00:00, "today" is already the new date. Always pass explicit dates in `YYYY-MM-DD` for predictability.

### 9.2. `periods=[]` means day-long, not "never"
An empty periods array matches ALL periods. Same if all three periods are selected. This surprises newcomers. If you want a task to NEVER show, soft-delete it (`DELETE /items/:id`), don't fight the periods array.

### 9.3. Weekdays are 0-indexed, Sunday-first
`weekdays: [0,1,2,3,4,5,6]` — 0=Sunday, 6=Saturday. Matches `Date.getDay()` in JS.

### 9.4. Protocol phases are routine_items rows
You cannot create a phase directly — you must create/update through `/protocols` endpoints. A phase has `protocol_id` set; a standalone item has `protocol_id = NULL`. `GET /items` filters to standalone only.

### 9.5. `PUT /protocols/:id` with `phases` is destructive
Sending the `phases` array replaces all phases (DELETE + INSERT). Daily_tasks of old phases are CASCADE-deleted, losing completion history. If you just want to rename the protocol or change its start_date, send **only** `name` / `start_date` / `repeat_indefinitely` without `phases`.

### 9.6. `convert-to-protocol` preserves task history
`POST /items/:id/convert-to-protocol` is the one safe way to turn a standalone item into a phase without losing daily_tasks — it reuses the original item id as the first phase.

### 9.7. Phase dates auto-calculated
Phase `start_date`/`end_date` are **computed** from the protocol's `start_date` + cumulative `duration_days`. Don't pass them in when creating a protocol — they'll be overwritten.

### 9.8. Settings validation is partial-update-aware
You can send just one of the three period times; the validator merges it with stored values and checks the resulting state. But if the merge fails chronology, you get 400.

### 9.9. `total_count` and followup
When you set `total_count` on an item and a daily_task toggle brings `completed_count` to that max, the server automatically:
1. Deactivates the original item
2. Creates a new item using the `followup_*` fields (if any)

That new item has its own id — track it if you need to.

### 9.10. Rate-limit buckets are per-token
If you have two agents sharing a token, they share a bucket. Create one token per agent for clean isolation and easier revocation.

---

## 10. Skill Template for External Agents

If you're building a Claude Code skill around this API, start with this SKILL.md:

```markdown
---
name: daily-screen
description: Use when Pedro asks to create/update/delete items, protocols, or settings in his Daily Screen app at daily.aiworks.app.br. Triggers include "adiciona no daily", "cria um protocolo", "marca como feito hoje", "desativa vitamina", "atualiza localização do weather".
---

# Daily Screen Integration

You have programmatic access to Pedro's Daily Screen app (a tablet-based medication/supplement/reminder checklist). Use the REST API at `https://daily.aiworks.app.br/integration/v1`.

## Setup

1. Token is stored in `$DS_TOKEN` env var (one-time setup by Pedro).
2. Always send `Authorization: Bearer $DS_TOKEN`.
3. Respect rate limits (120/min per token). Back off on 429.

## Common operations

### Add a new supplement
`POST /items` with `{ "title": "...", "category": "supplement", "icon": "💊" }`.

### Add a daily reminder with weekday filter
`POST /items` with `weekdays: [1,2,3,4,5]` (Mon-Fri) and appropriate periods.

### Create a dose-taper protocol
`POST /protocols` with phases array — each phase has `duration_days` and a full item config (title, category, icon, periods).

### Mark today's task as done
1. `GET /tasks` (defaults to today)
2. Find the task for the item
3. `POST /tasks/{id}/toggle`

### Change the city / timezone
`PUT /settings` with `weather_lat`, `weather_lon`, `weather_tz`, `weather_city`.

## Gotchas (CRITICAL to avoid data loss)

- `PUT /protocols/:id` with a `phases` array is DESTRUCTIVE. Use it only to restructure, not to rename.
- `DELETE /items/:id/permanent` and `DELETE /protocols/:id` both CASCADE-delete daily_tasks. Prefer soft-delete (`DELETE /items/:id` without `/permanent`).
- Dates are YYYY-MM-DD in the configured timezone (`weather_tz`), not UTC.
- `periods: []` means day-long, not "never". To hide, soft-delete.

## Reference

Full API guide: https://github.com/pedroberaldo87/daily-screen/blob/main/docs/2026-04-20-integration-api.md
```

---

## 11. Changelog

### v1.0 — 2026-04-20
- Initial release of `/integration/v1/*` endpoints
- Bearer token auth with SHA-256 hash storage
- Admin UI for token management at `/admin/tokens`
- Per-token rate limit (120/min) + per-IP failed-auth limit (60/15min)
- Full coverage of items, protocols, tasks, settings, weather, health
