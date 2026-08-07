import { useEffect, useState } from "react";
import type { AdminUserDetail, User } from "@turnapp/shared";
import { api } from "../api";

function formatDate(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}

export function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [adjusting, setAdjusting] = useState<User | null>(null);
  const [viewing, setViewing] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setUsers(await api.listUsers());
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <>
      <div className="page-head">
        <h1>Users</h1>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Email</th>
              <th>User ID</th>
              <th>Points</th>
              <th>Role</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>@ {u.username}</td>
                <td>{u.email}</td>
                <td>{u.userIdNumber}</td>
                <td>
                  <span className="coin">{u.pointsBalance.toLocaleString()}</span>
                </td>
                <td>
                  <span className="pill">{u.isAdmin ? "admin" : "member"}</span>
                </td>
                <td>
                  <div className="row-actions">
                    <button className="btn secondary small" onClick={() => setViewing(u)}>
                      View
                    </button>
                    <button className="btn secondary small" onClick={() => setAdjusting(u)}>
                      Add points
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {viewing && (
        <UserDetailModal
          userId={viewing.id}
          onClose={() => setViewing(null)}
          onAddPoints={() => {
            setAdjusting(viewing);
            setViewing(null);
          }}
        />
      )}

      {adjusting && (
        <PointsModal
          user={adjusting}
          onClose={() => setAdjusting(null)}
          onSaved={() => {
            setAdjusting(null);
            load();
          }}
        />
      )}
    </>
  );
}

function UserDetailModal({
  userId,
  onClose,
  onAddPoints,
}: {
  userId: string;
  onClose: () => void;
  onAddPoints: () => void;
}) {
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getUserDetail(userId)
      .then(setDetail)
      .catch((e) => setError((e as Error).message));
  }, [userId]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        {error && <div className="error">{error}</div>}
        {!detail ? (
          <p style={{ color: "var(--grey)" }}>Loading...</p>
        ) : (
          <>
            <div className="detail-head">
              <div>
                <h2 style={{ margin: 0 }}>@ {detail.user.username}</h2>
                <div style={{ color: "var(--grey)", fontSize: 13, marginTop: 2 }}>
                  {detail.user.email} · user id {detail.user.userIdNumber}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="coin" style={{ fontSize: 22 }}>
                  {detail.user.pointsBalance.toLocaleString()}
                </div>
                <button
                  className="btn secondary small"
                  style={{ marginTop: 6 }}
                  onClick={onAddPoints}
                >
                  Add points
                </button>
              </div>
            </div>

            <h3 className="detail-section">Collection ({detail.cards.length} cards)</h3>
            {detail.cards.length === 0 ? (
              <p style={{ color: "var(--grey)" }}>No cards collected yet.</p>
            ) : (
              <div className="collection-grid">
                {detail.cards.map((c) => (
                  <div key={c.id} className="collection-item">
                    {c.imageUrl ? (
                      <img src={c.imageUrl} alt={c.name} />
                    ) : (
                      <div className="collection-noimg" />
                    )}
                    {c.quantity > 1 && <span className="qty-badge">{c.quantity}</span>}
                    <div className="collection-name">{c.name}</div>
                    <div className="collection-num">{c.cardNumber}</div>
                  </div>
                ))}
              </div>
            )}

            <h3 className="detail-section">Points history ({detail.transactions.length})</h3>
            {detail.transactions.length === 0 ? (
              <p style={{ color: "var(--grey)" }}>No points transactions yet.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Source</th>
                    <th style={{ textAlign: "right" }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.transactions.map((t) => (
                    <tr key={t.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{formatDate(t.createdAt)}</td>
                      <td>{t.description}</td>
                      <td
                        style={{
                          textAlign: "right",
                          whiteSpace: "nowrap",
                          color: t.amount >= 0 ? "var(--black)" : "var(--danger)",
                          fontWeight: 700,
                        }}
                      >
                        {t.amount >= 0 ? "+" : "−"}
                        {Math.abs(t.amount).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="modal-actions">
              <button type="button" className="btn secondary" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PointsModal({
  user,
  onClose,
  onSaved,
}: {
  user: User;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState("100");
  const [description, setDescription] = useState("Admin reward");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.addPoints(user.id, Number(amount), description);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>Add points · @ {user.username}</h2>
        <p style={{ color: "var(--grey)", marginTop: 0 }}>
          Current balance: <span className="coin">{user.pointsBalance.toLocaleString()}</span>
        </p>
        <label>Amount (negative to deduct)</label>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <label>Description</label>
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" disabled={busy}>
            {busy ? "Saving..." : "Add transaction"}
          </button>
        </div>
      </form>
    </div>
  );
}
