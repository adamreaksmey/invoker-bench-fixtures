import express, { type Express } from "express";
import { Ledger } from "../../core/src/ledger";
import { AuthStore } from "./auth-store";
import { openDatabase } from "./db";
import { createAuthRouter, requireAuth, type AuthenticatedRequest } from "./auth-routes";
import type { DatabaseSync } from "node:sqlite";

export interface ApiOptions {
  db?: DatabaseSync;
  sessionSecret?: string;
}

export function createApp(options: ApiOptions = {}): Express {
  const db = options.db ?? openDatabase(process.env.DATABASE_PATH ?? "ledger.sqlite");
  const authStore = new AuthStore(db);
  const sessionSecret = options.sessionSecret ?? process.env.SESSION_SECRET ?? developmentSessionSecret();
  const ledgers = new Map<string, Ledger>();
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  app.use("/auth", createAuthRouter(authStore, sessionSecret));

  const authenticated = requireAuth(authStore, sessionSecret);
  const ledgerFor = (req: AuthenticatedRequest) => {
    const userId = req.user!.id;
    let ledger = ledgers.get(userId);
    if (!ledger) { ledger = new Ledger(); ledgers.set(userId, ledger); }
    return ledger;
  };
  app.get("/accounts", authenticated, (req: AuthenticatedRequest, res) => res.json(ledgerFor(req).listAccounts()));
  app.post("/accounts", authenticated, (req: AuthenticatedRequest, res) => {
    try { return res.status(201).json(ledgerFor(req).addAccount(req.body)); }
    catch (error) { return ledgerError(res, error); }
  });
  app.get("/transactions", authenticated, (req: AuthenticatedRequest, res) => {
    try { return res.json(ledgerFor(req).listTransactions(req.query.accountId as string | undefined)); }
    catch (error) { return ledgerError(res, error); }
  });
  app.post("/transactions", authenticated, (req: AuthenticatedRequest, res) => {
    try { return res.status(201).json(ledgerFor(req).addTransaction(req.body)); }
    catch (error) { return ledgerError(res, error); }
  });
  app.get("/accounts/:accountId/balance", authenticated, (req: AuthenticatedRequest, res) => {
    try { return res.json({ balanceCents: ledgerFor(req).getBalance(req.params.accountId) }); }
    catch (error) { return ledgerError(res, error); }
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof SyntaxError) return res.status(400).json({ error: "invalid JSON body" });
    console.error("API request failed", error);
    return res.status(500).json({ error: "internal server error" });
  });
  return app;
}

function ledgerError(res: express.Response, error: unknown) {
  const message = error instanceof Error ? error.message : "Invalid ledger request";
  const status = /Unknown account/.test(message) ? 404 : 400;
  return res.status(status).json({ error: message });
}

let warnedAboutDevelopmentSecret = false;
function developmentSessionSecret(): string {
  if (!warnedAboutDevelopmentSecret) {
    console.warn("SESSION_SECRET is unset; using an ephemeral development-only session secret. Set SESSION_SECRET before deployment.");
    warnedAboutDevelopmentSecret = true;
  }
  return `development-only-${process.pid}-${Date.now()}`;
}

if (process.argv[1] && /(?:^|[\\/])(?:src\/)?index\.(?:[cm]?[jt]s)$/.test(process.argv[1])) {
  const app = createApp();
  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, "127.0.0.1", () => console.log(`Personal ledger API listening on http://127.0.0.1:${port}`));
}
