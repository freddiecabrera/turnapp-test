import { api, setAuthToken } from "../src/api";
import { API_URL } from "../src/config";

// `request` is module-private, so these exercise it through the thin `api`
// wrappers. `seasons()` and `me()` return the response untouched, which keeps
// each case about `request`'s own error and 204 handling.

const mockFetch = jest.fn();

beforeEach(() => {
  mockFetch.mockReset();
  global.fetch = mockFetch as unknown as typeof fetch;
  // `authToken` is module-level state that outlives a single case.
  setAuthToken(null);
});

/** The `Headers` instance `request` actually handed to `fetch`. */
function sentHeaders(callIndex = 0): Headers {
  return mockFetch.mock.calls[callIndex][1].headers as Headers;
}

function mockOk(body: unknown) {
  mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => body });
}

describe("request error handling", () => {
  it("throws the API's error string so it can be shown to the user", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "You already collected this card" }),
    });

    await expect(api.seasons()).rejects.toThrow("You already collected this card");
  });

  it("falls back to a status-based message when the body carries no error", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    await expect(api.seasons()).rejects.toThrow("Request failed (500)");
  });

  it("falls back to a status-based message when the body is not JSON", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON");
      },
    });

    await expect(api.seasons()).rejects.toThrow("Request failed (502)");
  });
});

describe("request success handling", () => {
  it("returns undefined for a 204 instead of parsing an empty body", async () => {
    const json = jest.fn();
    mockFetch.mockResolvedValue({ ok: true, status: 204, json });

    await expect(api.me()).resolves.toBeUndefined();
    expect(json).not.toHaveBeenCalled();
  });

  it("parses and returns the body for a normal 200", async () => {
    const seasons = [{ id: "szn-1", name: "SZN 1" }];
    mockOk(seasons);

    await expect(api.seasons()).resolves.toEqual(seasons);
    expect(mockFetch.mock.calls[0][0]).toBe(`${API_URL}/seasons`);
  });
});

// These read the real `Headers` object off the recorded call rather than
// matching the init loosely: the whole app is behind `requireAuth`, so a
// dropped or renamed header turns every screen into a 401 that reads like a
// backend fault.
describe("request auth headers", () => {
  it("sends the token set by setAuthToken as a bearer credential", async () => {
    mockOk({ id: "u1" });
    setAuthToken("t");

    await api.me();

    expect(sentHeaders().get("Authorization")).toBe("Bearer t");
  });

  it("sends no Authorization header once the token is cleared", async () => {
    mockOk({ id: "u1" });
    setAuthToken("t");
    await api.me();

    setAuthToken(null);
    await api.me();

    expect(sentHeaders(1).get("Authorization")).toBeNull();
  });

  it("declares a JSON content type on every request", async () => {
    mockOk([]);

    await api.seasons();

    expect(sentHeaders().get("Content-Type")).toBe("application/json");
  });
});

// resolveImageUrl is covered in config.test.ts; what these pin is that each
// card-bearing endpoint is actually wired to it. The API serialises imageUrl as
// a host-relative path, so an unwired endpoint renders blank artwork while the
// resolveImageUrl unit test stays green and points the debugger at the wrong
// module. Every call site gets its own case because they are three separate
// `.then` hops, not one shared one.
describe("card image URLs", () => {
  const relative = { id: "c1", name: "Ace", imageUrl: "/static/cards/ace.png" };
  const absolute = `${API_URL}/static/cards/ace.png`;

  it("resolves the image path on every card from cards()", async () => {
    mockOk([relative]);

    const [card] = await api.cards();

    expect(card.imageUrl).toBe(absolute);
  });

  it("resolves the image path on a single card from card()", async () => {
    mockOk(relative);

    const card = await api.card("c1");

    expect(card.imageUrl).toBe(absolute);
  });

  it("resolves the image path on the card a scan awards", async () => {
    mockOk({ card: relative, pointsAwarded: 10, newBalance: 110, alreadyOwned: false });

    const result = await api.scan("QR-1");

    expect(result.card.imageUrl).toBe(absolute);
    expect(result.pointsAwarded).toBe(10);
  });
});
