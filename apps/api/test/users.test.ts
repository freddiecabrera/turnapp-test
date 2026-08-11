import { beforeEach, describe, expect, it } from "vitest";
import type { OwnedCard, UserSummary } from "@turnapp/shared";
import {
  api,
  authedApi,
  createUser,
  grant,
  prisma,
  resetDatabase,
  twoTraders,
} from "./helpers";

/**
 * Partner discovery, driven over HTTP so the auth middleware, the routing
 * stack and the serializers are all in the path — the layers where a leak
 * would actually happen.
 */

/** Anything that looks like an address or a bcrypt hash, anywhere in a body. */
function leaks(body: unknown): boolean {
  const json = JSON.stringify(body);
  return json.includes("@") || json.includes("$2");
}

describe("GET /users/search", () => {
  beforeEach(resetDatabase);

  it("finds a user by a fragment of their username", async () => {
    const { alice, bob } = await twoTraders();

    const res = await authedApi(alice, "get", "/users/search?q=bo");

    expect(res.status).toBe(200);
    const users = res.body as UserSummary[];
    expect(users.map((u) => u.id)).toEqual([bob.id]);
    expect(users[0]).toEqual({
      id: bob.id,
      username: bob.username,
      userIdNumber: bob.userIdNumber,
    });
  });

  it("matches the username case-insensitively", async () => {
    const { alice, bob } = await twoTraders();

    const upper = await authedApi(alice, "get", "/users/search?q=BOB");
    const mixed = await authedApi(alice, "get", "/users/search?q=Bo");

    expect((upper.body as UserSummary[]).map((u) => u.id)).toEqual([bob.id]);
    expect((mixed.body as UserSummary[]).map((u) => u.id)).toEqual([bob.id]);
  });

  it("finds a user by their exact userIdNumber", async () => {
    const { alice, bob } = await twoTraders();

    const res = await authedApi(alice, "get", `/users/search?q=${bob.userIdNumber}`);

    expect(res.status).toBe(200);
    expect((res.body as UserSummary[]).map((u) => u.id)).toEqual([bob.id]);
  });

  it("does not match a userIdNumber on a prefix", async () => {
    const { alice, bob } = await twoTraders();
    const prefix = String(bob.userIdNumber).slice(0, 4);

    const res = await authedApi(alice, "get", `/users/search?q=${prefix}`);

    expect((res.body as UserSummary[]).map((u) => u.id)).not.toContain(bob.id);
  });

  it("excludes the caller from their own results", async () => {
    // A fragment both usernames share, so the self-exclusion is the only thing
    // that can keep the caller out of this result.
    const caller = await createUser("scout-alice");
    const other = await createUser("scout-bob");

    const byName = await authedApi(caller, "get", "/users/search?q=scout");
    expect((byName.body as UserSummary[]).map((u) => u.id)).toEqual([other.id]);

    const byId = await authedApi(caller, "get", `/users/search?q=${caller.userIdNumber}`);
    expect(byId.body).toEqual([]);
  });

  it("excludes admins", async () => {
    const { alice } = await twoTraders();
    const admin = await createUser("adminuser", { isAdmin: true });

    const byName = await authedApi(alice, "get", "/users/search?q=adminuser");
    expect(byName.body).toEqual([]);

    const byId = await authedApi(alice, "get", `/users/search?q=${admin.userIdNumber}`);
    expect(byId.body).toEqual([]);
  });

  it("returns [] for an empty or whitespace-only query", async () => {
    const { alice } = await twoTraders();

    for (const url of ["/users/search", "/users/search?q=", "/users/search?q=%20%20"]) {
      const res = await authedApi(alice, "get", url);
      expect(res.status, url).toBe(200);
      expect(res.body, url).toEqual([]);
    }
  });

  it("handles a non-numeric query without erroring", async () => {
    const { alice } = await twoTraders();

    // "abc" would be a type error against the Int column if it reached it.
    const res = await authedApi(alice, "get", "/users/search?q=abc");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("handles a number too large for the userIdNumber column", async () => {
    const { alice, bob } = await twoTraders();
    // Past int4, and past Number.MAX_SAFE_INTEGER, but still all digits.
    for (const q of ["99999999999", "999999999999999999999"]) {
      const res = await authedApi(alice, "get", `/users/search?q=${q}`);
      expect(res.status, q).toBe(200);
      expect(res.body, q).toEqual([]);
    }

    // And a numeric string still searches usernames.
    await prisma.user.update({ where: { id: bob.id }, data: { username: "77777777777" } });
    const res = await authedApi(alice, "get", "/users/search?q=7777777777");
    expect((res.body as UserSummary[]).map((u) => u.id)).toEqual([bob.id]);
  });

  it("caps the number of results", async () => {
    const alice = await createUser("alice");
    // Sequentially, not Promise.all: `createUser` reads its fixture counter
    // after an await, so concurrent calls all land on the same userIdNumber
    // and collide on the unique constraint.
    for (let i = 0; i < 25; i += 1) {
      await createUser(`partner${String(i).padStart(2, "0")}`);
    }

    const res = await authedApi(alice, "get", "/users/search?q=partner");

    expect((res.body as UserSummary[]).length).toBeLessThanOrEqual(20);
  });

  it("does not treat % or _ in the query as wildcards", async () => {
    const caller = await createUser("caller");
    await createUser("Taylor Poole");
    await createUser("Casey Rhodes");

    // Unescaped, ILIKE reads these as "anything" and returns the whole
    // directory twenty rows at a time.
    for (const q of ["%", "_", "a%", "%%", "%_%"]) {
      const res = await authedApi(caller, "get", `/users/search?q=${encodeURIComponent(q)}`);
      expect(res.status, q).toBe(200);
      expect(res.body, q).toEqual([]);
    }
  });

  it("does not match a username through an underscore wildcard", async () => {
    const caller = await createUser("caller");
    const taylor = await createUser("Taylor Poole");

    const wild = await authedApi(caller, "get", "/users/search?q=T_ylor");
    expect(wild.body).toEqual([]);

    // The literal spelling still finds them, so this isn't just a dead query.
    const literal = await authedApi(caller, "get", "/users/search?q=Taylor");
    expect((literal.body as UserSummary[]).map((u) => u.id)).toEqual([taylor.id]);
  });

  it("finds a username that contains a LIKE metacharacter", async () => {
    const caller = await createUser("caller");
    const percent = await createUser("100%_real");
    const under = await createUser("under_score");
    const back = await createUser("back\\slash");

    const byUnderscore = await authedApi(caller, "get", `/users/search?q=${encodeURIComponent("_")}`);
    expect((byUnderscore.body as UserSummary[]).map((u) => u.id)).toEqual([percent.id, under.id]);

    const byPercent = await authedApi(caller, "get", `/users/search?q=${encodeURIComponent("100%")}`);
    expect((byPercent.body as UserSummary[]).map((u) => u.id)).toEqual([percent.id]);

    // Backslash is Postgres's own LIKE escape, so it has to survive escaping too.
    const byBackslash = await authedApi(caller, "get", `/users/search?q=${encodeURIComponent("k\\s")}`);
    expect((byBackslash.body as UserSummary[]).map((u) => u.id)).toEqual([back.id]);
  });

  it("rejects a null byte in the query without dropping the process", async () => {
    const { alice, bob } = await twoTraders();

    const res = await authedApi(alice, "get", "/users/search?q=a%00b");

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");

    // Postgres refuses 0x00 in a text value (22021). Unrejected it reached the
    // driver, and the rejected promise took the whole API down with it — so the
    // request that matters here is the next one.
    const after = await authedApi(alice, "get", "/users/search?q=bob");
    expect(after.status).toBe(200);
    expect((after.body as UserSummary[]).map((u) => u.id)).toEqual([bob.id]);
  });

  it("never returns an email address or a password hash", async () => {
    const { alice } = await twoTraders();

    const res = await authedApi(alice, "get", "/users/search?q=bob");

    expect(res.body).toHaveLength(1);
    expect(Object.keys(res.body[0]).sort()).toEqual(["id", "userIdNumber", "username"]);
    expect(leaks(res.body)).toBe(false);
  });

  it("401s without a token", async () => {
    await twoTraders();

    const res = await api().get("/users/search?q=bob");

    expect(res.status).toBe(401);
    expect(leaks(res.body)).toBe(false);
  });
});

describe("GET /users/:id/cards", () => {
  beforeEach(resetDatabase);

  it("returns only the cards that user owns, with their quantities", async () => {
    const { alice, bob, common, bobOnly, aliceOnly, dupe } = await twoTraders();

    const res = await authedApi(alice, "get", `/users/${bob.id}/cards`);

    expect(res.status).toBe(200);
    const cards = res.body as OwnedCard[];
    expect(cards.map((c) => c.id).sort()).toEqual([common.id, bobOnly.id].sort());
    expect(cards.find((c) => c.id === common.id)).toMatchObject({ quantity: 1 });

    // Alice's cards are not bob's, whichever way they differ.
    expect(cards.map((c) => c.id)).not.toContain(aliceOnly.id);
    expect(cards.map((c) => c.id)).not.toContain(dupe.id);
  });

  it("reports a quantity above one", async () => {
    const { alice, bob, dupe } = await twoTraders();
    await grant(bob.id, dupe.id, 3);

    const res = await authedApi(alice, "get", `/users/${bob.id}/cards`);

    expect((res.body as OwnedCard[]).find((c) => c.id === dupe.id)).toMatchObject({
      quantity: 3,
    });
  });

  it("omits a card with no UserCard row at all", async () => {
    const { alice, bob, aliceOnly } = await twoTraders();

    // The card exists in the season; bob has simply never collected it.
    expect(
      await prisma.userCard.findUnique({
        where: { userId_cardId: { userId: bob.id, cardId: aliceOnly.id } },
      })
    ).toBeNull();

    const res = await authedApi(alice, "get", `/users/${bob.id}/cards`);

    expect((res.body as OwnedCard[]).map((c) => c.id)).not.toContain(aliceOnly.id);
  });

  it("omits a card held at quantity zero", async () => {
    const { alice, bob, bobOnly } = await twoTraders();
    // A stray row at zero: not what the swap leaves behind, but the endpoint
    // must not offer it as tradable if one ever exists.
    await prisma.userCard.update({
      where: { userId_cardId: { userId: bob.id, cardId: bobOnly.id } },
      data: { quantity: 0 },
    });

    const res = await authedApi(alice, "get", `/users/${bob.id}/cards`);

    expect((res.body as OwnedCard[]).map((c) => c.id)).not.toContain(bobOnly.id);
  });

  it("rewrites image URLs to the relative /static/cards path", async () => {
    const { alice, bob, common } = await twoTraders();

    const res = await authedApi(alice, "get", `/users/${bob.id}/cards`);

    const card = (res.body as OwnedCard[]).find((c) => c.id === common.id);
    // The stored value is a bare filename; clients need the served path.
    expect(common.imageUrl).toBeTruthy();
    expect(card?.imageUrl).toBe(`/static/cards/${common.imageUrl}`);
    expect(card?.imageUrl).not.toBe(common.imageUrl);
    expect(card?.imageUrl).toMatch(/^\/static\/cards\/.+\.png$/);
  });

  it("includes firstScannedAt as an ISO string", async () => {
    const { alice, bob } = await twoTraders();

    const [card] = (await authedApi(alice, "get", `/users/${bob.id}/cards`)).body as OwnedCard[];

    expect(card.firstScannedAt).toEqual(expect.any(String));
    expect(new Date(card.firstScannedAt).toISOString()).toBe(card.firstScannedAt);
  });

  it("rejects a null byte in the id without dropping the process", async () => {
    const { alice, bob } = await twoTraders();

    const res = await authedApi(alice, "get", "/users/a%00b/cards");

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");

    // A path segment reaches Postgres exactly as a query value does, and the
    // same 22021 rejection killed the process before it was refused here.
    const after = await authedApi(alice, "get", `/users/${bob.id}/cards`);
    expect(after.status).toBe(200);
  });

  it("never returns an email address or a password hash", async () => {
    const { alice, bob } = await twoTraders();

    const res = await authedApi(alice, "get", `/users/${bob.id}/cards`);

    expect(res.body).not.toHaveLength(0);
    expect(leaks(res.body)).toBe(false);
  });

  it("404s for an unknown user id", async () => {
    const { alice } = await twoTraders();

    const res = await authedApi(alice, "get", "/users/does-not-exist/cards");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "User not found" });
  });

  it("401s without a token", async () => {
    const { bob } = await twoTraders();

    const res = await api().get(`/users/${bob.id}/cards`);

    expect(res.status).toBe(401);
    expect(leaks(res.body)).toBe(false);
  });
});
