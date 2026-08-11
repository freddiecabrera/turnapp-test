import { api } from "../src/api";
import { API_URL } from "../src/config";

// `request` is module-private, so these exercise it through the thin `api`
// wrappers. `seasons()` and `me()` return the response untouched, which keeps
// each case about `request`'s own error and 204 handling.

const mockFetch = jest.fn();

beforeEach(() => {
  mockFetch.mockReset();
  global.fetch = mockFetch as unknown as typeof fetch;
});

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
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => seasons,
    });

    await expect(api.seasons()).resolves.toEqual(seasons);
    expect(mockFetch).toHaveBeenCalledWith(`${API_URL}/seasons`, expect.anything());
  });
});
