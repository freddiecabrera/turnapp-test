import { useState } from "react";
import type { User } from "@turnapp/shared";
import { api, setToken } from "../api";

export function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [email, setEmail] = useState("admin@turn.app");
  const [password, setPassword] = useState("admin123");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api.login(email, password);
      if (!res.user.isAdmin) {
        throw new Error("This account is not an admin.");
      }
      setToken(res.token);
      onLogin(res.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="brand">turn</div>
        <div className="subtitle">admin dashboard</div>
        <label>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
        <label>Password</label>
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" />
        <div style={{ marginTop: 20 }}>
          <button className="btn" style={{ width: "100%" }} disabled={busy}>
            {busy ? "Signing in..." : "Sign in"}
          </button>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="hint">Seeded admin: admin@turn.app / admin123</div>
      </form>
    </div>
  );
}
