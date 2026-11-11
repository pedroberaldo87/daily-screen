# Security Policy

## Reporting a vulnerability

Please do not open a public issue with the details of a security problem.

Use GitHub's private reporting: open the **Security** tab of this repository and choose **Report a vulnerability**. If that option is not available, open a regular issue that only says you have a security report and asks for a private way to send it. Do not put exploit details, tokens or personal data in that issue.

This is a small project maintained by one person, so there is no guaranteed response time. Reports are read and answered as soon as possible.

## Supported versions

Only the latest commit on `main` is supported. There are no maintained release branches.

## Scope

In scope: the Express server, the admin sign-in (Google OpenID Connect), session handling, display pairing, the bearer-token Integration API, and the Docker and deploy files in this repository.

Out of scope: problems in a deployment you or someone else runs (reverse proxy, firewall, server hardening) and vulnerabilities in third-party dependencies that are already fixed upstream. For the latter, a pull request that updates the dependency is welcome.

## Notes for people who run an instance

- Serve it over HTTPS. With `NODE_ENV=production` the session cookie is `Secure`.
- Keep `SESSION_SECRET`, `GOOGLE_CLIENT_SECRET` and the API tokens out of version control. `.env` is already in `.gitignore`.
- List only the accounts you trust in `ADMIN_EMAILS`. The list is read from the environment, so removing an address and restarting ends that admin's existing sessions on their next request. To end every session at once (for example after a leaked cookie), change `SESSION_SECRET` and restart.
- When the app runs behind a reverse proxy, `NODE_ENV=production` sets `trust proxy` to 1 so that per-IP limits (sign-in start, failed logins) see the client address from `X-Forwarded-For`. Make sure your proxy overwrites that header rather than appending to one sent by the client.
- Every `/api/*` route needs an admin session, an integration token or a paired display. Treat `DISPLAY_KEY` like a password: it passes through the URL once at pairing, and changing it unpairs every display.
- An Integration API token has full access to that API. Revoke tokens you no longer use, in the admin panel under **Tokens**.
