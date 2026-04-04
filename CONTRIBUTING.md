# Contributing to Daily Screen

Thank you for your interest in contributing to Daily Screen! This document describes how to set up your development environment, the project structure, and guidelines for submitting contributions.

## Getting Started

### Prerequisites

- Node.js 20 or later
- npm 10 or later
- A text editor or IDE of your choice
- A browser that supports modern JavaScript and Service Workers

### Local Setup

1. Clone the repository

```bash
git clone https://github.com/pedroberaldo87/daily-screen.git
cd daily-screen
```

2. Copy the environment template

```bash
cp .env.example .env
```

3. Install dependencies

```bash
npm install
```

4. Start the development server

```bash
npm run dev
```

This runs Node.js in watch mode — the server restarts automatically when you edit files.

5. Open your browser

Visit `http://localhost:3000` to see the display view, and `http://localhost:3000/admin` to access the admin panel.

The default login password is specified in your `.env` file (set via `ADMIN_PASSWORD`).

## Project Structure

Daily Screen follows a simple directory layout designed for quick understanding and modification:

- **server.js** — Express entry point and route mounting
- **db.js** — SQLite schema, database initialization, and query helpers
- **weather.js** — Weather API client (Open-Meteo) and caching logic
- **session-store.js** — Custom SQLite-backed session store for admin authentication
- **routes/** — Express route handlers (display, admin, API)
- **middleware/** — Authentication and other request middleware
- **public/** — Client-side assets (CSS, vanilla JavaScript, Service Worker)
- **views/** — HTML templates (display, admin panel, login)
- **Dockerfile** — Multi-stage build for production deployment
- **docker/** — Docker Compose configuration and environment templates

For a more detailed overview, see the project README.

## Development Notes

### No Build Step

Daily Screen intentionally avoids TypeScript, bundlers, and transpilers. This means:

- Edit files directly and refresh your browser to see changes
- No compilation errors to debug — only runtime errors
- Fast feedback loop during development
- Simpler codebase to navigate and understand

The trade-off is that you won't catch type errors before runtime. This is acceptable for a small project, and pull requests that add a test suite are very welcome!

### CommonJS Module System

The project uses Node.js CommonJS (`require` and `module.exports`). If you're adding new server-side code, follow this pattern:

```javascript
const express = require('express');
const db = require('./db');

// Your code here

module.exports = router;
```

Client-side code uses vanilla JavaScript without module imports.

### Testing on the Target Viewport

Daily Screen is designed for a 1280×800 landscape display (Fire HD 8 tablet). Before submitting a pull request:

- Test your changes at this resolution
- Use your browser's responsive design mode: `Command+Shift+M` (Mac) or `Ctrl+Shift+M` (Windows/Linux)
- Set custom dimensions to 1280×800 in the device toolbar

Changes to the display view should look good on this screen size without requiring horizontal scrolling.

### Frontend: Vanilla JavaScript and CSS

The frontend uses vanilla HTML, CSS, and JavaScript — no frameworks like React, Vue, or Angular. This keeps the codebase lightweight and suitable for an embedded device.

CSS theming uses custom properties (CSS variables). These are defined in `public/style.css` and can be overridden per-page. For example:

```css
:root {
  --fs-clock: 120px;
  --fs-greeting: 48px;
  --color-bg: #1a1a1a;
}
```

### Service Worker Cache Management

The app includes a Service Worker in `public/sw.js` that caches static assets (shell) and API responses. When you modify static assets:

1. Increment `CACHE_NAME` at the top of `public/sw.js`
2. Push your changes
3. Tablets will update on their next check (usually within 1 minute)

Example:

```javascript
const CACHE_NAME = 'daily-screen-v3'; // was v2
```

If users don't see your changes after deploying, they may need to clear the Service Worker cache manually in their browser or tablet settings.

### Express 5 and Async Error Handling

Daily Screen uses Express 5, which has built-in support for async route handlers and middleware. You can use `async/await` directly in route handlers:

```javascript
router.get('/api/tasks', async (req, res) => {
  const tasks = await db.getTasks(req.query.date);
  res.json(tasks);
});
```

Errors thrown in async handlers are automatically caught and passed to error-handling middleware. No need for try/catch blocks unless you want custom error handling.

### Database: SQLite with better-sqlite3

The project uses SQLite with the `better-sqlite3` driver, which provides a synchronous API. All database queries are executed synchronously:

```javascript
const row = db.prepare('SELECT * FROM routine_items WHERE id = ?').get(itemId);
const rows = db.prepare('SELECT * FROM routine_items').all();
```

If you're adding new database functionality:

1. Add schema changes to the `initializeDatabase()` function in `db.js`
2. Use the `columnExists()` helper to make migrations safe (idempotent)
3. Keep queries in `db.js` — export helper functions for use in routes

### Icons: Unicode Emoji

Icons are stored as Unicode emoji characters directly in the database. When creating or editing routine items, you can use any emoji. The admin panel includes an emoji picker with Portuguese keywords for convenience. When adding new features that display icons, simply render the character as-is:

```html
<span class="icon">${item.icon}</span>
```

## Pull Request Guidelines

### Before Submitting

- Keep your PR focused on a single feature or bug fix
- Test your changes on the 1280×800 viewport
- Maintain code style consistency with the existing codebase
- Update documentation if your changes affect how users or developers interact with the app

### What to Include

- A clear, descriptive title (e.g., "Add Spanish language support" or "Fix weather cache invalidation")
- A summary of what changed and why
- Steps to test your changes (especially important for UI changes and new endpoints)
- Screenshots or browser recordings if your PR affects the user interface

### Code Style

There is no automated linting or formatting enforced yet. Follow these conventions to stay consistent:

- Use 2-space indentation
- Avoid unnecessary comments (code should be clear)
- Keep functions focused and reasonably sized
- Use descriptive variable and function names
- Prefer `const` and `let` over `var`

### Testing

Currently, Daily Screen has no automated test suite. This is a significant gap, and contributions that add tests are especially valuable. If you're adding new functionality, consider:

- Writing tests for API endpoints (especially for database queries)
- Testing your changes manually on the target viewport
- Documenting edge cases in your PR

## Areas Where Help Is Needed

### Test Suite

Daily Screen has no automated tests. This is a major opportunity to contribute! Consider adding:

- Unit tests for database queries (`db.js`)
- Integration tests for API endpoints
- A test database fixture for consistent test data

The project is open to adding a test framework (Jest, Vitest, etc.) if you'd like to pioneer this effort.

### Accessibility Improvements

The display view and admin panel should be usable by people with disabilities. Contributions that improve accessibility are very welcome:

- Add proper ARIA labels and roles
- Improve color contrast ratios
- Ensure keyboard navigation works throughout the app
- Test with screen readers

### Internationalization (i18n)

Daily Screen currently has a Portuguese user interface. Help expanding language support is greatly appreciated:

- Extract UI strings into language files
- Add support for multiple languages in settings
- Consider locale-aware date and time formatting
- Translate to new languages (Spanish, French, etc.)

### Documentation Improvements

Contributions that clarify existing documentation or add new guides are always welcome:

- Expand the README with deployment guides
- Add troubleshooting sections
- Document the API endpoints
- Create guides for running on different devices

### Bug Reports and Feature Requests

If you find a bug or have a feature idea:

- Check existing issues to avoid duplicates
- Open an issue with a clear description
- For bugs, include steps to reproduce and your environment (Node version, OS, browser)
- For features, explain the use case and why it matters

## Questions or Need Help?

If you're unsure about something, feel free to:

- Open a discussion issue describing what you're trying to do
- Ask for clarification in a pull request
- Review existing code and issues for examples

This is a small project, and we're friendly and encouraging to all contributors.

Happy coding!
