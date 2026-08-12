import { API_URL, resolveImageUrl } from "./config";
import type {
  AuthResponse,
  Card,
  CardWithOwnership,
  CreateTradeRequest,
  OwnedCard,
  ScanResult,
  Season,
  Trade,
  User,
  UserSummary,
  WalletResponse,
} from "./types";

/**
 * Resolve a card's relative `imageUrl` into something the device can load.
 *
 * Generic over the card shape rather than fixed to `CardWithOwnership`, because
 * three different DTOs carry a card now: the collection grid's
 * `CardWithOwnership`, another user's `OwnedCard`, and the two plain `Card`s on
 * a `Trade`. The API returns `/static/cards/...` for all of them by design —
 * each client resolves it against the host it used to reach the API — so a DTO
 * that skips this renders a blank image on a physical device while looking
 * perfectly fine in a simulator, where the relative path happens to resolve.
 */
function withImageUrl<T extends Card>(card: T): T {
  return { ...card, imageUrl: resolveImageUrl(card.imageUrl) };
}

/** Both of a trade's cards, resolved. Neither is optional, so neither is skipped. */
function withTradeImages(trade: Trade): Trade {
  return {
    ...trade,
    offeredCard: withImageUrl(trade.offeredCard),
    requestedCard: withImageUrl(trade.requestedCard),
  };
}

/**
 * A failure the server described.
 *
 * The distinction this class exists to make: an `ApiError`'s `message` is a
 * sentence the API wrote for a human and the UI should render verbatim
 * (AGENTS.md, "Conventions" — routes answer `{ error }` and those strings are
 * user-facing copy). Anything else thrown out of `request` is not. A dropped
 * connection rejects with whatever the platform's fetch says — "Network request
 * failed", a URL, a native stack — which is a diagnostic, not copy, and must
 * never reach a screen.
 *
 * So `e instanceof ApiError` is the test for "safe to show as-is", and every
 * other rejection falls back to a string from `copy.ts`. `status` is carried
 * for callers that want to branch on it; the message is usually the better
 * answer, since the server already worded the 403, 404 and 409 cases.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
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
    const body: unknown = await res.json().catch(() => ({}));
    const error = (body as { error?: unknown }).error;
    // Only a string the server actually sent becomes an `ApiError`. The
    // fallback below is a status line rather than copy, so it stays a plain
    // Error and screens replace it with their own wording.
    if (typeof error === "string" && error) throw new ApiError(res.status, error);
    throw new Error(`Request failed (${res.status})`);
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

  /**
   * The whole board: every trade the caller has ever been in, both directions,
   * ordered `createdAt DESC, id DESC`.
   *
   * Takes no parameters — there is no server-side filtering and no pagination —
   * so all/incoming/outgoing is a client-side filter on `direction`. Note the
   * order is by `createdAt`, not `respondedAt`: a month-old trade answered
   * today stays a month down the list.
   */
  trades: () => request<Trade[]>("/trades").then((trades) => trades.map(withTradeImages)),

  /** Offer one of your cards for one of theirs. The cards do not move until they accept. */
  createTrade: (toUserId: string, offeredCardId: string, requestedCardId: string) =>
    request<Trade>("/trades", {
      method: "POST",
      body: JSON.stringify({
        toUserId,
        offeredCardId,
        requestedCardId,
      } satisfies CreateTradeRequest),
    }).then(withTradeImages),

  /** Accept a trade sent to you. Swaps both cards atomically; only the recipient may call it. */
  acceptTrade: (id: string) =>
    request<Trade>(`/trades/${encodeURIComponent(id)}/accept`, { method: "POST" }).then(
      withTradeImages
    ),

  /** Decline a trade sent to you. Nothing moves; only the recipient may call it. */
  declineTrade: (id: string) =>
    request<Trade>(`/trades/${encodeURIComponent(id)}/decline`, { method: "POST" }).then(
      withTradeImages
    ),

  /**
   * Find a trading partner by username fragment or exact ID number.
   *
   * Returns at most 20, never the caller, never a staff account, and an empty
   * array for an empty query. `q` is encoded rather than interpolated raw: a
   * username fragment is arbitrary user input, and an `&`, `+` or `#` in it
   * would otherwise change the query string's shape instead of being searched
   * for.
   */
  searchUsers: (q: string) => request<UserSummary[]>(`/users/search?q=${encodeURIComponent(q)}`),

  /** What another user owns, so the caller can pick a card to ask for. Collections are public. */
  userCards: (id: string) =>
    request<OwnedCard[]>(`/users/${encodeURIComponent(id)}/cards`).then((cards) =>
      cards.map(withImageUrl)
    ),
};
