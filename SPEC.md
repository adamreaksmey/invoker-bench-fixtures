# P1 — Personal ledger: persist ledger data in SQLite

## Product context

A personal-finance ledger: users register, sign in, create accounts, and record income/expense
transactions in integer cents. Auth already persists in SQLite, but accounts and transactions live
in an in-memory `Map<string, Ledger>` inside `packages/api/src/index.ts`, so all ledger data is lost
when the API restarts.

## Required changes

1. **Versioned migrations.** Add a migration runner with a schema version table. Create
   accounts/transactions tables keyed by user. Auth tables must keep working on new and existing
   databases.
2. **Service layer.** Domain operations (add account, list accounts, add transaction, list
   transactions, balance) live in a service that does not depend on Express and has unit tests.
   Keep the existing domain rules from `packages/core/src/ledger.ts` (trimmed non-empty ids/names,
   unknown account errors, duplicate id errors, safe-integer non-zero `amountCents`).
3. **Persisted API.** Replace the in-memory map with persisted storage scoped per authenticated
   user. Each user only ever sees their own accounts and transactions.
4. **Restart survival.** Data written through the API must be returned unchanged by a new
   `createApp()` instance opened on the same `DATABASE_PATH`. Add an integration test for this.
5. **Frontend.** The web app must keep working end to end: register, add an account, record a
   transaction, see the balance, reload, sign out, sign back in, and still see the balance.
   Fix any frontend bug that prevents this flow.
6. **Regression.** All existing tests pass; `npm run build` succeeds.

## Contracts that must not change

- `packages/api/src/index.ts` exports `createApp(options?: { db?: DatabaseSync; sessionSecret?: string })`.
  When `db` is omitted it opens `process.env.DATABASE_PATH`.
- Routes and JSON shapes: `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`,
  `GET /auth/me`, `GET|POST /accounts`, `GET|POST /transactions` (`?accountId=` filter),
  `GET /accounts/:accountId/balance` → `{ "balanceCents": number }`.
- Error statuses: unknown account → 404; validation / duplicate errors → 400; unauthenticated → 401.
- Account body `{ id, name }`; transaction body `{ id, accountId, amountCents, description? }`.
- Web UI labels used by users: "Create an account", "Username", "Password", "Create account",
  "Account name", "Add account", "Description", "Amount", "Save transaction", "Sign out", "Sign in",
  and the balance shown in the `.balance-amount` element formatted like `$125.50`.

## Out of scope

New features (budgets, recurring transactions, exports), deployment changes.

## Verification you can run

`npm test` and `npm run build`. An end-to-end smoke exists in `e2e/` (`npm run test:e2e`).
