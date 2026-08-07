import { useState } from "react";
import type { Card } from "@turnapp/shared";
import { api } from "../api";

export interface SeasonOption {
  id: string;
  name: string;
}

export function CardModal({
  card,
  seasons,
  defaultSeasonId,
  onClose,
  onSaved,
}: {
  card: Card | null;
  seasons: SeasonOption[];
  defaultSeasonId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: card?.name ?? "",
    type: card?.type ?? "",
    universe: card?.universe ?? "",
    rarity: card?.rarity ?? "",
    rarityLevel: card?.rarityLevel?.toString() ?? "",
    cardNumber: card?.cardNumber ?? "",
    story: card?.story ?? "",
    seasonId: card?.seasonId ?? defaultSeasonId ?? seasons[0]?.id ?? "",
  });
  const [image, setImage] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      if (image) fd.append("image", image);
      if (card) await api.updateCard(card.id, fd);
      else await api.createCard(fd);
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
        <h2>{card ? "Edit card" : "New card"}</h2>
        <label>Name *</label>
        <input value={form.name} onChange={(e) => set("name", e.target.value)} required />
        <div className="grid-2">
          <div>
            <label>Type</label>
            <input value={form.type} onChange={(e) => set("type", e.target.value)} />
          </div>
          <div>
            <label>Universe</label>
            <input value={form.universe} onChange={(e) => set("universe", e.target.value)} />
          </div>
          <div>
            <label>Rarity</label>
            <input value={form.rarity} onChange={(e) => set("rarity", e.target.value)} />
          </div>
          <div>
            <label>Rarity level</label>
            <input
              type="number"
              value={form.rarityLevel}
              onChange={(e) => set("rarityLevel", e.target.value)}
            />
          </div>
          <div>
            <label>Card number</label>
            <input
              value={form.cardNumber}
              placeholder="e.g. 3/15"
              onChange={(e) => set("cardNumber", e.target.value)}
            />
          </div>
        </div>
        <label>Collection *</label>
        <select value={form.seasonId} onChange={(e) => set("seasonId", e.target.value)} required>
          {seasons.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <label>Story</label>
        <textarea value={form.story} onChange={(e) => set("story", e.target.value)} />
        <label>Image {card ? "(leave empty to keep current)" : ""}</label>
        <input type="file" accept="image/*" onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" disabled={busy}>
            {busy ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
