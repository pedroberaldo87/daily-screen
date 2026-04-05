# Security Audit Report — Daily Screen

**Date:** 2026-04-04
**Scope:** Code review (open source repo) + penetration test (live deploy at daily.aiworks.app.br)
**Methodology:** Static analysis + automated probing via agent team (3 specialists in parallel)

---

## Executive Summary

The Daily Screen app has a **solid security foundation**: parameterized SQL queries, Helmet with strict CSP, session-based auth on all mutations, rate-limited login, non-root Docker user, and zero secrets in git history.

**No injection vulnerabilities were exploitable on the live deploy** — SQLi, XSS, CSRF, path traversal, and auth bypass all passed testing.

The main risks are:
1. **Unauthenticated read endpoints** expose personal health data (medication schedule, location)
2. **Code-level XSS vectors** in admin.js onclick handlers (exploitable only with admin access)
3. **Timing-unsafe password comparison** (theoretical, requires network-level access)

---

## Findings by Severity

### CRITICAL

#### C1 — Unauthenticated API Endpoints Expose Health Data

- **Endpoints:** `GET /api/tasks`, `GET /api/items`, `GET /api/settings`, `GET /api/weather`
- **Evidence:** All return 200 with full data without any authentication
- **Impact:** Anyone with the URL sees medication names, supplement schedule, completion status, GPS coordinates, and city name
- **Risk context:** App is HTTPS-only and not indexed, but URL is guessable (`daily.aiworks.app.br`)
- **Fix:** Add auth middleware to `/api/items` and `/api/settings`. For `/api/tasks`, consider a read-only token or separate the display data from admin data.
- **Design tension:** The tablet display needs unauthenticated access to tasks and weather. Options:
  - (A) Add a read-only API key for the tablet (query param or header)
  - (B) Separate public display endpoints (limited fields) from admin endpoints (full data)
  - (C) Accept the risk for a self-hosted personal app

---

#### C2 — DOM XSS via onclick Handlers in Admin Panel

- **File:** **public/admin.js** lines 47, 49, 50, 52
- **Vector:** Item titles injected into `onclick="confirmDelete(${id}, '${title.replace(...)}')"` with insufficient escaping
- **Evidence (code review):** Only single quotes are escaped; payloads like `'); alert('xss'); //` could break out
- **Live test result:** NOT directly testable via curl (requires browser context + admin session to create malicious item)
- **Impact:** If an attacker has admin access and creates a malicious item title, JavaScript executes in any admin session viewing the list
- **Risk context:** Single-user app with one password — attacker would need admin access first, reducing practical impact
- **Fix:** Replace inline `onclick` with event listeners via `addEventListener()`. Store item ID in `data-id` attribute.

---

#### C3 — DOM XSS in Icon Picker Search

- **File:** **public/icon-picker.js** line 367
- **Vector:** `grid.innerHTML = '...Nenhum resultado para "' + q + '"...'` — search query concatenated into HTML without escaping
- **Impact:** Typing `<img src=x onerror=alert(1)>` in the emoji picker search executes JavaScript
- **Risk context:** Requires admin session + manual input in the picker. No remote exploitation vector.
- **Fix:** Use `textContent` instead of `innerHTML`, or escape `q` with the existing `escapeHtml()` function.

---

### HIGH

#### H1 — Timing-Unsafe Password Comparison

- **File:** **routes/admin.js** line 24
- **Code:** `if (password === process.env.ADMIN_PASSWORD)`
- **Impact:** Theoretical timing attack to deduce password character-by-character
- **Risk context:** Requires network-level timing precision; rate limiting (5 attempts/15min) makes practical exploitation extremely difficult
- **Fix:** `crypto.timingSafeEqual(Buffer.from(password), Buffer.from(process.env.ADMIN_PASSWORD))`

---

#### H2 — SSH StrictHostKeyChecking Disabled in Deploy Script

- **File:** **deploy.sh** lines 14, 35
- **Code:** `StrictHostKeyChecking=no`
- **Impact:** MITM attack during deploy could intercept code or inject commands
- **Risk context:** Only runs from Pedro's local machine to known VPS
- **Fix:** Change to `StrictHostKeyChecking=accept-new` or pre-populate `~/.ssh/known_hosts`

---

#### H3 — Plain Text Password Without Hashing

- **File:** **routes/admin.js** line 24, **.env**
- **Impact:** If `.env` on VPS is compromised, password is immediately readable. No defense-in-depth.
- **Risk context:** Single-user personal app; `.env` access implies server access
- **Fix:** Use `bcrypt.compare()` with a hashed password in `.env`

---

### MEDIUM

#### M1 — CSP Allows unsafe-inline for Styles

- **File:** **server.js** line 21
- **Impact:** Inline CSS injection possible (minor XSS vector)
- **Fix:** Move inline styles to external CSS, remove `'unsafe-inline'` from `styleSrc`

---

#### M2 — Duplicate/Conflicting Security Headers (Helmet + Caddy)

- **Evidence (live):** Headers appear twice with different values:
  - `X-Frame-Options`: DENY (Helmet) + SAMEORIGIN (Caddy)
  - `Referrer-Policy`: strict-origin-when-cross-origin (Helmet) + no-referrer (Caddy)
  - `Strict-Transport-Security`: duplicated
  - `X-Content-Type-Options`: duplicated
- **Impact:** Browsers use the last/most-restrictive value. Not exploitable, but unpredictable.
- **Fix:** Remove security headers from Caddy config (let Helmet handle them) OR remove from Helmet (let Caddy handle them). Pick one source of truth.

---

#### M3 — CSP font-src Blocks Google Fonts

- **Evidence (live):** CSP sets `font-src 'self'` but HTML loads fonts from `fonts.googleapis.com` / `fonts.gstatic.com`
- **Impact:** Fonts silently fail to load; page falls back to system fonts
- **Fix:** Add `https://fonts.googleapis.com https://fonts.gstatic.com` to `fontSrc` (and `styleSrc` for the CSS), OR self-host the fonts

---

#### M4 — Missing Input Validation on API

- **Endpoints:** `POST /api/items`, `GET /api/tasks?date=`
- **Impact:** Malformed dates return empty arrays (no crash), but invalid categories cause database errors
- **Fix:** Validate date format (`/^\d{4}-\d{2}-\d{2}$/`), validate category against allowed values, validate weekdays JSON structure

---

#### M5 — Session Cookie MaxAge 30 Days

- **File:** **server.js** line 44
- **Impact:** Long session window increases exposure if cookie is stolen
- **Fix:** Reduce to 7-14 days for admin sessions

---

#### M6 — Missing Permissions-Policy Header

- **Evidence (live):** Header not present in response
- **Impact:** Browser features (camera, mic, geolocation) not explicitly restricted
- **Fix:** Add `Permissions-Policy` to Helmet config: `camera=(), microphone=(), geolocation=()`

---

### LOW

#### L1 — Deploy User is Root

- **File:** **deploy.sh** line 9 — `DEPLOY_USER:-root`
- **Fix:** Create dedicated deploy user with scoped permissions

---

#### L2 — Docker Base Image Not Pinned to Digest

- **File:** **Dockerfile** line 1
- **Fix:** Pin to `node:20-alpine@sha256:...` for reproducible builds

---

#### L3 — No Rate Limiting on API Endpoints

- **Impact:** Only login is rate-limited. API writes could be spammed (but require auth).
- **Fix:** Add general rate limiter for authenticated API routes

---

#### L4 — Console.error in Production Frontend

- **Files:** **public/display.js**, **public/admin.js**
- **Impact:** Error details visible in browser DevTools
- **Fix:** Wrap in `if (location.hostname === 'localhost')` or remove

---

#### L5 — No security.txt

- **Fix:** Add `/.well-known/security.txt` with contact info for responsible disclosure

---

#### L6 — No SRI on Google Fonts

- **Files:** **views/display.html**, **views/admin.html**
- **Impact:** CDN compromise could inject malicious CSS
- **Fix:** Add `integrity` attribute to Google Fonts links (or self-host)

---

## What Passed (Positive Findings)

| Area | Result |
|------|--------|
| SQL Injection | PASS — parameterized queries via better-sqlite3 |
| Reflected XSS | PASS — JSON responses, no HTML reflection |
| CSRF | PASS — no CORS, SameSite cookies, auth on mutations |
| Path Traversal | PASS — Express static blocks traversal |
| Auth Bypass | PASS — session validation solid, forged cookies rejected |
| Source Code Exposure | PASS — no files accessible outside /public |
| Git History Secrets | PASS — no real credentials ever committed |
| Directory Listing | PASS — disabled |
| Dependency Vulnerabilities | PASS — `npm audit` clean, 0 vulnerabilities |
| Docker Security | PASS — non-root user, multi-stage build, no exposed ports |
| HTTPS/TLS | PASS — Caddy with Let's Encrypt, HSTS enabled |
| Rate Limiting (login) | PASS — 5 attempts per 15 minutes |

---

## Recommended Fix Priority

### Do Now (quick wins, high impact)
1. **C2/C3** — Fix XSS in admin.js and icon-picker.js (replace innerHTML/onclick with safe alternatives)
2. **H1** — Use `crypto.timingSafeEqual()` for password comparison (1-line fix)
3. **H2** — Change `StrictHostKeyChecking=no` to `accept-new` in deploy.sh (1-line fix)
4. **M2** — Remove duplicate headers (pick Helmet OR Caddy as source of truth)

### Do Soon (moderate effort)
5. **M3** — Fix CSP font-src to allow Google Fonts (or self-host)
6. **M4** — Add input validation on API endpoints
7. **M6** — Add Permissions-Policy header

### Decide Intentionally (architecture decision)
8. **C1** — Unauthenticated API endpoints. Requires design decision:
   - (A) Read-only API token for tablet
   - (B) Separate public/admin endpoints
   - (C) Accept risk for personal self-hosted app

### Nice to Have
9. **H3** — Bcrypt password hashing
10. **M5** — Reduce session maxAge
11. **L1-L6** — Low severity items
