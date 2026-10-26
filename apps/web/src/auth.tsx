import { createContext, useCallback, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";

export interface User { id: string; username: string }
interface SessionValue {
  user: User | null;
  loading: boolean;
  error: string;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/auth${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "include",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error ?? `Request failed (${response.status})`);
  }
  return response.status === 204 ? undefined as T : response.json();
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const payload = await request<{ user: User }>("/me");
      setUser(payload.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const authenticate = useCallback(async (path: string, username: string, password: string) => {
    setError("");
    try {
      const payload = await request<{ user: User }>(path, { username, password });
      setUser(payload.user);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Unable to sign in";
      setError(message);
      throw reason;
    }
  }, []);
  const login = useCallback((username: string, password: string) => authenticate("/login", username, password), [authenticate]);
  const register = useCallback((username: string, password: string) => authenticate("/register", username, password), [authenticate]);
  const logout = useCallback(async () => {
    setError("");
    try { await request<void>("/logout", {}); }
    finally { setUser(null); }
  }, []);
  const value = useMemo(() => ({ user, loading, error, login, register, logout }), [user, loading, error, login, register, logout]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside SessionProvider");
  return context;
}

export function AuthGate() {
  const { login, register, error } = useSession();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const action = mode === "login" ? login : register;
      await action(String(data.get("username")), String(data.get("password")));
    } catch { /* The provider exposes the request error. */ }
    finally { setBusy(false); }
  }
  return <main className="auth-layout">
    <section className="auth-card">
      <div className="brand-mark" aria-hidden="true">PL</div>
      <p className="eyebrow">A quieter way to keep track</p>
      <h1>Your money,<br />in clear view.</h1>
      <p className="muted">A personal ledger for the decisions you make every day.</p>
      <form onSubmit={submit}>
        <label>Username<input name="username" autoComplete="username" required minLength={3} /></label>
        <label>Password<input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button>
      </form>
      <p className="auth-switch">{mode === "login" ? "New to your ledger?" : "Already have an account?"} <button className="text-button" onClick={() => setMode(mode === "login" ? "register" : "login")}>{mode === "login" ? "Create an account" : "Sign in"}</button></p>
    </section>
    <aside className="auth-aside"><div className="aside-art" aria-hidden="true"><span>↗</span><div className="art-line" /><div className="art-dot" /></div><p className="aside-caption">Small steps add up.</p><p className="aside-subtitle">See where you are.<br />Choose where you’re going.</p></aside>
  </main>;
}
