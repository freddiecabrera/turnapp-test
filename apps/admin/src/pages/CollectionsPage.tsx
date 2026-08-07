import { useEffect, useMemo, useState } from "react";
import type { AdminCollection, Card } from "@turnapp/shared";
import { api } from "../api";
import { CardModal, type SeasonOption } from "../components/CardModal";
import { CardDetailPage } from "./CardDetailPage";

export function CollectionsPage() {
  const [collections, setCollections] = useState<AdminCollection[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [openCollection, setOpenCollection] = useState<AdminCollection | null>(null);
  const [openCard, setOpenCard] = useState<Card | null>(null);
  const [editing, setEditing] = useState<Card | "new" | null>(null);
  const [newCollection, setNewCollection] = useState(false);

  const seasons: SeasonOption[] = useMemo(
    () => collections.map((c) => ({ id: c.id, name: c.name })),
    [collections]
  );

  async function load() {
    try {
      const [cols, allCards] = await Promise.all([api.listCollections(), api.listCards()]);
      setCollections(cols);
      setCards(allCards);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Keep the currently-open collection object fresh after reloads.
  useEffect(() => {
    if (openCollection) {
      const fresh = collections.find((c) => c.id === openCollection.id);
      if (fresh) setOpenCollection(fresh);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collections]);

  async function removeCard(card: Card) {
    if (!confirm(`Delete "${card.name}"?`)) return;
    await api.deleteCard(card.id);
    load();
  }

  // ---- Level 3: card detail ----
  if (openCard) {
    return (
      <CardDetailPage
        card={openCard}
        seasons={seasons}
        onBack={() => setOpenCard(null)}
        onChanged={load}
      />
    );
  }

  // ---- Level 2: cards in a collection ----
  if (openCollection) {
    const inCollection = cards.filter((c) => c.seasonId === openCollection.id);
    return (
      <>
        <div className="crumbs">
          <button className="link-btn" onClick={() => setOpenCollection(null)}>
            ← collections
          </button>
        </div>
        <div className="page-head">
          <div>
            <h1 style={{ margin: 0 }}>{openCollection.name}</h1>
            {openCollection.description && <div className="muted">{openCollection.description}</div>}
          </div>
          <button className="btn" onClick={() => setEditing("new")}>
            + New card
          </button>
        </div>
        {error && <div className="error">{error}</div>}

        <div className="card">
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Name</th>
                <th>#</th>
                <th>Type</th>
                <th>Rarity</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {inCollection.map((card) => (
                <tr key={card.id} className="row-clickable" onClick={() => setOpenCard(card)}>
                  <td>
                    {card.imageUrl ? (
                      <img className="thumb" src={card.imageUrl} alt={card.name} />
                    ) : (
                      <div className="thumb" />
                    )}
                  </td>
                  <td>{card.name}</td>
                  <td>{card.cardNumber}</td>
                  <td>
                    <span className="pill">{card.type}</span>
                  </td>
                  <td>
                    <span className="pill">{card.rarity}</span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="row-actions">
                      <button className="btn secondary small" onClick={() => setOpenCard(card)}>
                        Open
                      </button>
                      <button className="btn secondary small" onClick={() => setEditing(card)}>
                        Edit
                      </button>
                      <button className="btn danger small" onClick={() => removeCard(card)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {inCollection.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", color: "var(--grey)" }}>
                    No cards in this collection yet — add one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {editing && (
          <CardModal
            card={editing === "new" ? null : editing}
            seasons={seasons}
            defaultSeasonId={openCollection.id}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              load();
            }}
          />
        )}
      </>
    );
  }

  // ---- Level 1: collections ----
  return (
    <>
      <div className="page-head">
        <h1 style={{ margin: 0 }}>Collections</h1>
        <button className="btn" onClick={() => setNewCollection(true)}>
          + New collection
        </button>
      </div>
      {error && <div className="error">{error}</div>}

      <div className="collection-cards">
        {collections.map((c) => (
          <button
            key={c.id}
            className="collection-card"
            onClick={() => setOpenCollection(c)}
          >
            <div className="collection-card-name">{c.name}</div>
            {c.description && <div className="collection-card-desc">{c.description}</div>}
            <div className="collection-card-stats">
              <span>
                <strong>{c.cardCount}</strong> cards
              </span>
              <span>
                <strong>{c.qrScanned}</strong> / {c.qrTotal} codes scanned
              </span>
            </div>
          </button>
        ))}
        {collections.length === 0 && <p className="muted">No collections yet.</p>}
      </div>

      {newCollection && (
        <NewCollectionModal
          onClose={() => setNewCollection(false)}
          onCreated={() => {
            setNewCollection(false);
            load();
          }}
        />
      )}
    </>
  );
}

function NewCollectionModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createCollection({ name, description: description || undefined });
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>New collection</h2>
        <label>Name *</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. SZN 2"
          required
        />
        <label>Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Short description of the collection"
        />
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" disabled={busy}>
            {busy ? "Creating..." : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
