# Personal ledger

## Development

This repository uses npm workspaces. Shared ledger and authentication rules live in `packages/core`; the local HTTP API lives in `packages/api`.

- `npm install` installs workspace dependencies.
- `npm test` runs tests in workspaces that define a test script.
- `npm run build` runs build scripts in workspaces that define one.

Tests use Vitest. Start the API with `npm run start --workspace @personal-ledger/api`; it listens on `127.0.0.1:3000` by default. Set `PORT` and `DATABASE_PATH` to override those defaults.

Start the web app in a second terminal with `npm run dev --workspace @personal-ledger/web` (http://127.0.0.1:5173). The dev server proxies `/api/*` to the local API, so the browser uses the API's HttpOnly session cookie without a cloud service or token storage.

### Auth smoke steps

1. Start the API and web app as above.
2. Open the web app, choose **Create an account**, and register a new username with a password of at least 8 characters.
3. Confirm the ledger loads, add an account, then record an income and an expense. Confirm the balance and recent activity update.
4. Refresh the page and confirm the session restores; choose **Sign out** and confirm the login screen returns.
5. Sign in again with the same account. To check account separation, use a private browser window and create a second user; each user should see an empty ledger.

`npm run build` builds the web app and all other workspaces.

Set `SESSION_SECRET` to a long, random value before running the API outside local development. If it is omitted, the API prints a warning and uses an ephemeral development-only secret, which invalidates sessions after restart and must not be used for deployment. Copy `.env.example` to `.env` and supply your own secret.
