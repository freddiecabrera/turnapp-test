import { useEffect, useState } from "react";
import type { User } from "@turnapp/shared";
import { api, clearToken, getToken } from "./api";
import { Login } from "./pages/Login";
import { CollectionsPage } from "./pages/CollectionsPage";
import { UsersPage } from "./pages/UsersPage";

type Tab = "collections" | "users";

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("collections");

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then((u) => {
        if (u.isAdmin) setUser(u);
        else clearToken();
      })
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;

  if (!user) return <Login onLogin={setUser} />;

  function logout() {
    clearToken();
    setUser(null);
  }

  return (
    <>
      <header className="topbar">
        <span className="brand">turn</span>
        <nav>
          <button
            className={tab === "collections" ? "active" : ""}
            onClick={() => setTab("collections")}
          >
            Collections
          </button>
          <button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}>
            Users
          </button>
        </nav>
        <span className="spacer" />
        <span style={{ fontSize: 14, opacity: 0.8 }}>@ {user.username}</span>
        <button className="logout" onClick={logout}>
          Log out
        </button>
      </header>
      <main className="container">
        {tab === "collections" && <CollectionsPage />}
        {tab === "users" && <UsersPage />}
      </main>
    </>
  );
}
