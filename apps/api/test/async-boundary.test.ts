import { beforeEach, describe, expect, it } from "vitest";
import { api, authedApi, createUser, resetDatabase, twoTraders } from "./helpers";

/**
 * The async error boundary, exercised through real routes on every router.
 *
 * Express 4 ignores the promise an `async` handler returns, so a rejection
 * inside one is an unhandled rejection — and Node 20 exits on those by default.
 * Before `asyncRouter`, each request below killed the API process outright,
 * which made one request from any authenticated account a denial of service
 * against everybody.
 *
 * A null byte is the cheapest way to make a real handler reject: Postgres
 * refuses `0x00` inside a `text` value with `22021 invalid byte sequence for
 * encoding "UTF8"`, whatever the query around it is. That lets these cases go
 * through the routes as they actually ship, rather than through a throwing stub
 * that would only prove the wrapper wraps.
 *
 * Each case asserts two things: the response is the error middleware's JSON
 * 500, and the server answers the *next* request. Without the boundary the
 * first request gets no response at all and the run dies with it.
 */

/** Percent-encoded null byte, for use inside a URL. */
const NUL = "a%00b";
/** The same thing already decoded, for a JSON body. */
const NUL_TEXT = "a\u0000b";

async function expectStillServing() {
  const res = await api().get("/health");
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true });
}

function expectJson500(res: { status: number; body: unknown }) {
  expect(res.status).toBe(500);
  expect(typeof (res.body as { error?: unknown }).error).toBe("string");
}

describe("async error boundary", () => {
  beforeEach(resetDatabase);

  it("turns a rejected promise in routes/app.ts into a JSON 500", async () => {
    const { alice } = await twoTraders();

    // Pre-existing on the base branch: the same crash the two new /users routes
    // had, in a route that shipped long before them.
    const res = await authedApi(alice, "get", `/cards?seasonId=${NUL}`);

    expectJson500(res);
    await expectStillServing();
  });

  it("turns a rejected promise in POST /scan into a JSON 500", async () => {
    const { alice } = await twoTraders();

    const res = await authedApi(alice, "post", "/scan").send({ code: NUL_TEXT });

    expectJson500(res);
    await expectStillServing();
  });

  it("turns a rejected promise in routes/auth.ts into a JSON 500", async () => {
    // No token needed — login is the one route reachable anonymously, which
    // makes it the widest-open instance of the crash.
    const res = await api()
      .post("/auth/login")
      .send({ email: `${NUL_TEXT}@test.local`, password: "whatever" });

    expectJson500(res);
    await expectStillServing();
  });

  it("turns a rejected promise in routes/admin.ts into a JSON 500", async () => {
    const admin = await createUser("boundary-admin", { isAdmin: true });

    const res = await authedApi(admin, "get", `/admin/qrcodes?cardId=${NUL}`);

    expectJson500(res);
    await expectStillServing();
  });

  it("keeps serving normal traffic after handlers have rejected", async () => {
    const { alice, bob } = await twoTraders();

    await authedApi(alice, "get", `/cards?seasonId=${NUL}`);
    await authedApi(alice, "get", `/cards?seasonId=${NUL}`);

    // The failure is per-request, not per-process: the same route still works.
    const ok = await authedApi(alice, "get", "/cards");
    expect(ok.status).toBe(200);
    expect(Array.isArray(ok.body)).toBe(true);

    const search = await authedApi(alice, "get", "/users/search?q=bob");
    expect(search.status).toBe(200);
    expect((search.body as Array<{ id: string }>).map((u) => u.id)).toEqual([bob.id]);
  });
});
