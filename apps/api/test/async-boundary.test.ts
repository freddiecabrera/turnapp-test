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

/**
 * Substrings that must never appear in a 500 body.
 *
 * A rejected Prisma query stringifies to the failing call, an absolute path
 * into the source tree, and the surrounding lines of that file. Returning
 * `err.message` published all of it — so these are the fingerprints of that
 * message, not an exhaustive list of every secret. The point is that the client
 * is told a fixed sentence and nothing derived from the error at all.
 */
const INTERNAL_MARKERS = [
  // The developer's home directory, and with it the tree layout.
  "/Users/",
  // Prisma's own call notation, e.g. `prisma.user.findUnique()`.
  "prisma.",
  // How every Prisma client error opens: "Invalid `prisma.x.y()` invocation".
  "Invalid `",
];

/**
 * Asserted against the raw response text rather than `body.error`, so a leak
 * that lands in some other field is caught too.
 */
function expectNoInternals(res: { status: number; text: string }) {
  expect(res.status).toBe(500);
  for (const marker of INTERNAL_MARKERS) {
    expect(res.text).not.toContain(marker);
  }
}

/**
 * The other half of the boundary: what it says on the way out.
 *
 * Routing rejections to the error middleware fixed the crash and, for as long
 * as that middleware returned `err.message`, replaced it with a disclosure —
 * the Prisma error above, reachable with no token at all through `POST
 * /auth/login`. A denial of service traded for an information leak is not a
 * fix, so these cases pin the trade shut from both ends: nothing internal in
 * the body, and the process still serving after.
 */
describe("error middleware response body", () => {
  beforeEach(resetDatabase);

  it("returns no path or Prisma internals to an anonymous caller", async () => {
    // The widest-open instance: no token, and the null byte reaches Postgres
    // through the email lookup in routes/auth.ts.
    const res = await api()
      .post("/auth/login")
      .send({ email: `${NUL_TEXT}@test.local`, password: "whatever" });

    expectNoInternals(res);
    await expectStillServing();
  });

  it("returns no path or Prisma internals to an authenticated caller", async () => {
    const { alice } = await twoTraders();

    const res = await authedApi(alice, "get", `/cards?seasonId=${NUL}`);

    expectNoInternals(res);
    await expectStillServing();
  });

  it("says the same fixed thing whatever the route or the error", async () => {
    const { alice } = await twoTraders();
    const admin = await createUser("leak-admin", { isAdmin: true });

    const [anon, user, adminRes] = [
      await api()
        .post("/auth/login")
        .send({ email: `${NUL_TEXT}@test.local`, password: "whatever" }),
      await authedApi(alice, "get", `/cards?seasonId=${NUL}`),
      await authedApi(admin, "get", `/admin/qrcodes?cardId=${NUL}`),
    ];

    // One sentence for every unanticipated failure. A body that varied with the
    // error would be a channel back out however carefully it was worded.
    const messages = [anon, user, adminRes].map((r) => (r.body as { error: string }).error);
    expect(new Set(messages).size).toBe(1);
    expect(messages[0]).toBeTruthy();

    await expectStillServing();
  });
});
