import { API_URL, resolveImageUrl } from "./config";
import type {
  AuthResponse,
  CardWithOwnership,
  ScanResult,
  Season,
  User,
  WalletResponse,
} from "./types";

function withImageUrl(card: CardWithOwnership): CardWithOwnership {
  return { ...card, imageUrl: resolveImageUrl(card.imageUrl) };
}

let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (authToken) headers.set("Authorization", `Bearer ${authToken}`);

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  login: (email: string, password: string) =>
    request<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  me: () => request<User>("/auth/me"),
  seasons: () => request<Season[]>("/seasons"),
  cards: (seasonId?: string) =>
    request<CardWithOwnership[]>(`/cards${seasonId ? `?seasonId=${seasonId}` : ""}`).then((cards) =>
      cards.map(withImageUrl)
    ),
  card: (id: string) => request<CardWithOwnership>(`/cards/${id}`).then(withImageUrl),
  wallet: () => request<WalletResponse>("/wallet"),
  scan: (code: string) =>
    request<ScanResult>("/scan", { method: "POST", body: JSON.stringify({ code }) }).then(
      (result) => ({ ...result, card: withImageUrl(result.card) })
    ),
};
