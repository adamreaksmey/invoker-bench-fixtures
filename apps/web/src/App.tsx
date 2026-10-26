import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AuthGate, SessionProvider, useSession } from "./auth";

interface Account { id: string; name: string }
interface Transaction { id: string; accountId: string; amountCents: number; description?: string }

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "include",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error ?? `Request failed (${response.status})`);
  }
  return response.json();
}

function Ledger() {
  const { user, logout } = useSession();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [accountId, setAccountId] = useState("");

  const load = useCallback(async () => {
    try {
      const [nextAccounts, nextTransactions] = await Promise.all([
        api<Account[]>("/accounts"), api<Transaction[]>("/transactions"),
      ]);
      setAccounts(nextAccounts);
      setTransactions(nextTransactions);
      setAccountId(current => current || nextAccounts[0]?.id || "");
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load your ledger"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function addAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const created = await api<Account>("/accounts", { id: crypto.randomUUID(), name: data.get("name") });
      event.currentTarget.reset();
      setAccountId(created.id);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create account"); }
    finally { setBusy(false); }
  }

  async function addTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const amount = Math.round(Number(data.get("amount")) * 100);
      await api("/transactions", { id: crypto.randomUUID(), accountId, amountCents: data.get("type") === "expense" ? -amount : amount, description: data.get("description") });
      event.currentTarget.reset();
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save transaction"); }
    finally { setBusy(false); }
  }

  const selected = accounts.find(account => account.id === accountId);
  const balance = transactions.filter(item => item.accountId === accountId).reduce((sum, item) => sum + item.amountCents, 0);
  return <div className="app-shell">
    <header className="topbar"><a className="wordmark" href="#"><span className="brand-mark small">PL</span> Ledger</a><div className="user-actions"><span className="user-name">{user?.username}</span><button className="quiet-button" onClick={() => void logout()}>Sign out</button></div></header>
    <main className="dashboard">
      <div className="welcome-row"><div><p className="eyebrow">YOUR PERSONAL LEDGER</p><h1>Good to see you, {user?.username}.</h1><p className="muted">A clear picture of what’s moving.</p></div><div className="date-chip">{new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date())}</div></div>
      {error && <div className="notice" role="alert">{error} <button onClick={() => void load()}>Try again</button></div>}
      <section className="summary-grid">
        <article className="balance-card"><div className="card-top"><span className="card-label">CURRENT BALANCE</span><span className="balance-icon">↗</span></div><p className="balance-amount">{new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(balance / 100)}</p><p className="balance-note">{selected?.name ?? "Choose an account below"}</p>{accounts.length > 1 && <select aria-label="Account" value={accountId} onChange={event => setAccountId(event.target.value)}>{accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select>}</article>
        <article className="stat-card"><span className="card-label">ACCOUNTS</span><p className="stat-value">{accounts.length.toString().padStart(2, "0")}</p><p className="muted">Keeping things together</p></article>
        <article className="stat-card"><span className="card-label">RECENT ACTIVITY</span><p className="stat-value">{transactions.length.toString().padStart(2, "0")}</p><p className="muted">Entries in your ledger</p></article>
      </section>
      <section className="content-grid">
        <article className="panel activity-panel"><div className="panel-heading"><div><p className="eyebrow">THE DETAILS</p><h2>Recent activity</h2></div><span className="activity-count">{transactions.length} entries</span></div>
          {transactions.length === 0 ? <div className="empty-state"><div className="empty-icon">↘</div><h3>Your ledger starts here.</h3><p>Add an account, then record your first transaction.</p></div> : <div className="transaction-list">{transactions.slice().reverse().map(item => <div className="transaction-row" key={item.id}><div className={`transaction-icon ${item.amountCents < 0 ? "expense" : "income"}`}>{item.amountCents < 0 ? "↘" : "↗"}</div><div className="transaction-copy"><strong>{item.description ?? "Transaction"}</strong><span>{accounts.find(a => a.id === item.accountId)?.name ?? "Account"}</span></div><strong className={`transaction-amount ${item.amountCents < 0 ? "negative" : ""}`}>{item.amountCents < 0 ? "−" : "+"}{new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(Math.abs(item.amountCents) / 100)}</strong></div>)}</div>}
        </article>
        <div className="forms-column"><article className="panel form-panel"><p className="eyebrow">GET STARTED</p><h2>Add an account</h2><p className="form-hint">A place to keep track of money.</p><form onSubmit={addAccount}><label>Account name<input name="name" placeholder="Everyday checking" required /></label><button className="primary-button" disabled={busy}>Add account <span>↗</span></button></form></article>
          <article className="panel form-panel"><p className="eyebrow">MAKE AN ENTRY</p><h2>New transaction</h2><form onSubmit={addTransaction}><label>Account<select required value={accountId} onChange={event => setAccountId(event.target.value)} disabled={!accounts.length}>{accounts.length ? accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>) : <option value="">Add an account first</option>}</select></label><label>Description<input name="description" placeholder="What was it for?" required /></label><div className="field-row"><label>Amount<input name="amount" type="number" step="0.01" min="0.01" placeholder="0.00" required /></label><label>Type<select name="type"><option value="income">Income</option><option value="expense">Expense</option></select></label></div><button className="primary-button" disabled={busy || !accounts.length}>Save transaction <span>↗</span></button></form></article></div>
      </section>
      <footer className="footer">Your ledger, just for you. <span>Personal Ledger · {new Date().getFullYear()}</span></footer>
    </main>
  </div>;
}

function AppContent() {
  const { user, loading } = useSession();
  if (loading) return <div className="loading-screen"><span className="brand-mark">PL</span><p>Opening your ledger…</p></div>;
  return user ? <Ledger /> : <AuthGate />;
}

export default function App() {
  return <SessionProvider><AppContent /></SessionProvider>;
}
