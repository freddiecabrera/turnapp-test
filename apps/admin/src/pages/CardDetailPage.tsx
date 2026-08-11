import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import type { Card, CardStats, QrCode } from "@turnapp/shared";
import { api } from "../api";
import { CardModal, type SeasonOption } from "../components/CardModal";
import { QrPrintModal } from "../components/QrPrintModal";

interface Batch {
  key: string;
  label: string;
  createdAt: string;
  pointsAwarded: number;
  codes: QrCode[];
  scanned: number;
}

function groupIntoBatches(codes: QrCode[]): Batch[] {
  const map = new Map<string, QrCode[]>();
  for (const c of codes) {
    const key = c.batchId ?? "ungrouped";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(c);
  }
  const batches: Batch[] = [];
  for (const [key, list] of map) {
    const sorted = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const first = sorted[0];
    batches.push({
      key,
      label: first.batchLabel || (key === "ungrouped" ? "Unlabeled codes" : "Batch"),
      createdAt: first.createdAt,
      pointsAwarded: first.pointsAwarded,
      codes: sorted,
      scanned: sorted.filter((c) => c.scannedAt).length,
    });
  }
  // Newest batch first.
  return batches.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const date = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${date} ${time}`;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat-card">
      <div className="stat-value">{value.toLocaleString()}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export function CardDetailPage({
  card: initialCard,
  seasons,
  onBack,
  onChanged,
}: {
  card: Card;
  seasons: SeasonOption[];
  onBack: () => void;
  onChanged: () => void;
}) {
  const [card, setCard] = useState<Card>(initialCard);
  const [stats, setStats] = useState<CardStats | null>(null);
  const [codes, setCodes] = useState<QrCode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [printCodes, setPrintCodes] = useState<QrCode[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [enlarged, setEnlarged] = useState<QrCode | null>(null);

  const batches = useMemo(() => groupIntoBatches(codes), [codes]);

  // Make-more form
  const [count, setCount] = useState("10");
  const [points, setPoints] = useState("50");
  const [batchLabel, setBatchLabel] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadStats() {
    try {
      setStats(await api.cardStats(card.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function loadCodes() {
    try {
      setCodes(await api.listQrCodes({ cardId: card.id }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    loadStats();
    loadCodes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id]);

  async function makeMore(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api.createQrBatch({
        cardId: card.id,
        count: Number(count),
        pointsAwarded: Number(points),
        // Omitted rather than sent as `undefined`: the parameter is
        // `batchLabel?: string`, and JSON.stringify drops an undefined value
        // anyway, so the request on the wire is unchanged.
        ...(batchLabel ? { batchLabel } : {}),
      });
      setPrintCodes(created);
      setBatchLabel("");
      await Promise.all([loadCodes(), loadStats()]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeCode(code: QrCode) {
    if (!confirm(`Delete code ${code.code}?`)) return;
    await api.deleteQrCode(code.id);
    await Promise.all([loadCodes(), loadStats()]);
  }

  return (
    <>
      <div className="detail-head">
        <div>
          <div className="crumbs">
            <button className="link-btn" onClick={onBack}>
              ← back to cards
            </button>
          </div>
          <h1 style={{ margin: "6px 0 0" }}>{card.name}</h1>
          <div className="muted">
            {card.cardNumber ? `${card.cardNumber} · ` : ""}
            {[card.type, card.universe, card.rarity].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn secondary" onClick={() => setEditing(true)}>
            Edit card
          </button>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="detail-cols">
        {card.imageUrl && <img className="detail-art" src={card.imageUrl} alt={card.name} />}
        <div style={{ flex: 1 }}>
          <div className="stat-cards">
            <Stat label="people who have it" value={stats?.ownersCount ?? 0} />
            <Stat label="total copies out" value={stats?.totalCopies ?? 0} />
            <Stat label="QR codes made" value={stats?.qrTotal ?? 0} />
            <Stat label="QR scanned" value={stats?.qrScanned ?? 0} />
          </div>
          {card.story && <p className="muted" style={{ marginTop: 16 }}>{card.story}</p>}
        </div>
      </div>

      {/* Make more codes */}
      <h2 className="section-title">QR codes</h2>
      <form className="card batch-form" onSubmit={makeMore}>
        <div className="batch-field small">
          <label>How many</label>
          <input type="number" min={1} max={500} value={count} onChange={(e) => setCount(e.target.value)} />
        </div>
        <div className="batch-field small">
          <label>Points / scan</label>
          <input type="number" value={points} onChange={(e) => setPoints(e.target.value)} />
        </div>
        <div className="batch-field">
          <label>Batch label (optional)</label>
          <input
            value={batchLabel}
            placeholder="e.g. print run #2"
            onChange={(e) => setBatchLabel(e.target.value)}
          />
        </div>
        <button className="btn" disabled={busy}>
          {busy ? "Making..." : "Make more codes"}
        </button>
      </form>

      <div className="qr-summary" style={{ marginBottom: 12 }}>
        {codes.length} codes · {codes.filter((c) => c.scannedAt).length} scanned ·{" "}
        {batches.length} {batches.length === 1 ? "batch" : "batches"}
      </div>

      {batches.length === 0 && (
        <div className="card" style={{ padding: 20, textAlign: "center", color: "var(--grey)" }}>
          No codes yet — make a batch above.
        </div>
      )}

      <div className="batch-list">
        {batches.map((b) => {
          const isOpen = expanded === b.key;
          return (
            <div key={b.key} className="batch-panel">
              <button
                className="batch-header"
                onClick={() => setExpanded(isOpen ? null : b.key)}
              >
                <span className={`chevron ${isOpen ? "open" : ""}`}>▶</span>
                <span className="batch-title">{b.label}</span>
                <span className="muted">{new Date(b.createdAt).toLocaleDateString()}</span>
                <span className="batch-meta">
                  <strong>{b.codes.length}</strong> codes
                </span>
                <span className="batch-meta">
                  <strong>{b.scanned}</strong> scanned
                </span>
                <span className="batch-meta">{b.pointsAwarded} pts/scan</span>
                <span
                  className="btn secondary small batch-print"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPrintCodes(b.codes);
                  }}
                >
                  Print batch
                </span>
              </button>

              {isOpen && (
                <div className="qr-grid">
                  {b.codes.map((c) => (
                    <div key={c.id} className="qr-code-cell">
                      <button
                        className="qr-thumb"
                        title="Click to enlarge & download"
                        onClick={() => setEnlarged(c)}
                      >
                        <QRCodeCanvas value={c.code} size={84} />
                      </button>
                      <div className="qr-code-text">{c.code}</div>
                      <span className={`pill ${c.scannedAt ? "pill-scanned" : "pill-unused"}`}>
                        {c.scannedAt ? "scanned" : "unused"}
                      </span>
                      {c.scannedAt && (
                        <div className="qr-scan-info">
                          {c.scannedByUsername ? `@ ${c.scannedByUsername}` : ""}
                          <br />
                          {formatDateTime(c.scannedAt)}
                        </div>
                      )}
                      <button className="btn danger small" onClick={() => removeCode(c)}>
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Owners */}
      <h2 className="section-title">Owners</h2>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>User ID</th>
              <th>Qty</th>
              <th>First collected</th>
            </tr>
          </thead>
          <tbody>
            {(stats?.owners ?? []).map((o) => (
              <tr key={o.userIdNumber}>
                <td>@ {o.username}</td>
                <td>{o.userIdNumber}</td>
                <td>{o.quantity}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {new Date(o.firstScannedAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {stats && stats.owners.length === 0 && (
              <tr>
                <td colSpan={4} style={{ textAlign: "center", color: "var(--grey)" }}>
                  Nobody has this card yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <CardModal
          card={card}
          seasons={seasons}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            const fresh = await api.listCards();
            const updated = fresh.find((c) => c.id === card.id);
            if (updated) setCard(updated);
            onChanged();
          }}
        />
      )}

      {printCodes && <QrPrintModal codes={printCodes} onClose={() => setPrintCodes(null)} />}

      {enlarged && <QrEnlargeModal code={enlarged} onClose={() => setEnlarged(null)} />}
    </>
  );
}

function QrEnlargeModal({ code, onClose }: { code: QrCode; onClose: () => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);

  function download() {
    const canvas = wrapRef.current?.querySelector("canvas");
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `${code.code}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal qr-enlarge" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>QR code</h2>
        <div ref={wrapRef} className="qr-enlarge-canvas">
          <QRCodeCanvas value={code.code} size={260} includeMargin />
        </div>
        <div className="qr-code-text" style={{ textAlign: "center", marginTop: 12 }}>
          {code.code}
        </div>
        <div className="modal-actions">
          <button className="btn secondary" onClick={onClose}>
            Close
          </button>
          <button className="btn" onClick={download}>
            Download PNG
          </button>
        </div>
      </div>
    </div>
  );
}
