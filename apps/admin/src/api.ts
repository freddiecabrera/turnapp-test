import type {
  AdminCollection,
  AdminUserDetail,
  AuthResponse,
  Card,
  CardStats,
  QrCode,
  User,
} from "@turnapp/shared";
import { API_URL } from "./config";

const TOKEN_KEY = "turn_admin_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// The API returns relative image paths (e.g. "/static/cards/x.png"); resolve
// them against the API base so <img> tags load correctly.
function resolveImageUrl(imageUrl: string | null): string | null {
  if (!imageUrl) return null;
  if (imageUrl.startsWith("http")) return imageUrl;
  return `${API_URL}${imageUrl.startsWith("/") ? "" : "/"}${imageUrl}`;
}

function withImageUrl(card: Card): Card {
  return { ...card, imageUrl: resolveImageUrl(card.imageUrl) };
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  // Don't set Content-Type for FormData; the browser adds the boundary.
  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
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

  listCards: () => request<Card[]>("/admin/cards").then((cards) => cards.map(withImageUrl)),
  createCard: (form: FormData) =>
    request<Card>("/admin/cards", { method: "POST", body: form }).then(withImageUrl),
  updateCard: (id: string, form: FormData) =>
    request<Card>(`/admin/cards/${id}`, { method: "PUT", body: form }).then(withImageUrl),
  deleteCard: (id: string) =>
    request<void>(`/admin/cards/${id}`, { method: "DELETE" }),

  listUsers: () => request<User[]>("/admin/users"),
  getUserDetail: (id: string) =>
    request<AdminUserDetail>(`/admin/users/${id}`).then((detail) => ({
      ...detail,
      cards: detail.cards.map((c) => ({ ...c, imageUrl: resolveImageUrl(c.imageUrl) })),
    })),
  addPoints: (id: string, amount: number, description: string) =>
    request<User>(`/admin/users/${id}/points`, {
      method: "POST",
      body: JSON.stringify({ amount, description }),
    }),

  listSeasons: () => request<{ id: string; name: string }[]>("/seasons"),
  listCollections: () => request<AdminCollection[]>("/admin/collections"),
  createCollection: (body: { name: string; description?: string }) =>
    request<AdminCollection>("/admin/collections", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  cardStats: (id: string) => request<CardStats>(`/admin/cards/${id}/stats`),

  listQrCodes: (params?: { cardId?: string; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.cardId) q.set("cardId", params.cardId);
    if (params?.status) q.set("status", params.status);
    const qs = q.toString();
    return request<QrCode[]>(`/admin/qrcodes${qs ? `?${qs}` : ""}`);
  },
  createQrBatch: (body: {
    cardId: string;
    count: number;
    pointsAwarded: number;
    batchLabel?: string;
  }) => request<QrCode[]>("/admin/qrcodes/batch", { method: "POST", body: JSON.stringify(body) }),
  deleteQrCode: (id: string) => request<void>(`/admin/qrcodes/${id}`, { method: "DELETE" }),
};
