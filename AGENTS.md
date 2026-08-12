# AGENTS.md

Context for AI coding agents working in this repo. Read this before running anything.

`README.md` is the human quickstart and is accurate. This file covers what it doesn't: the
things that cost an agent a wasted turn to discover.

---

## Cold start

From the repo root, in this order. Every step matters.

```bash
cp .env.example .env          # REQUIRED FIRST — see "Env" below
npm install                   # root workspaces only: packages/*, apps/api, apps/admin
npm --prefix apps/mobile install   # mobile is NOT a workspace — separate install
npm run api:setup             # docker up + prisma generate + migrate + seed
```

Then each service in its own terminal:

```bash
npm run dev:api      # http://localhost:4000
npm run dev:admin    # http://localhost:5173
npm run dev:mobile   # Expo — press i for simulator, or scan the QR
```

Prerequisites: Node ≥ 20, Docker running, Xcode if you want the iOS simulator.

---

## The six things that will trip you up

**1. `apps/mobile` is not in the npm workspace.**
`package.json` lists `packages/*`, `apps/api`, `apps/admin` — mobile is deliberately excluded
to avoid Metro monorepo issues. Root `npm install` does **not** install its dependencies and
gives no warning. Run `npm --prefix apps/mobile install` separately.

**2. `.env` is gitignored, and the Prisma scripts depend on it.**
A fresh clone has no `.env`. Every Prisma script loads it explicitly
(`dotenv -e ../../.env -- prisma ...`), so `cp .env.example .env` must happen before
`api:setup` or migrations fail with an unhelpful error. `docker-compose.yml` has inline
defaults (`${POSTGRES_USER:-turn}`) so the container starts either way — which makes this
fail *late* and confusingly.

**3. `npm run api:migrate` hardcodes the migration name.**
```json
"migrate": "dotenv -e ../../.env -- prisma migrate dev --name init"
```
Fine for first setup, wrong for any new migration. To add one, bypass the script:
```bash
cd apps/api && npx dotenv -e ../../.env -- npx prisma migrate dev --name your_migration_name
```

**4. Card images are gitignored and only exist after seeding.**
`.gitignore` excludes `apps/api/static/cards/*`. The seed copies 15 PNGs out of
`assets/SZN 1_cards/` into that directory. So `GET /static/cards/*.png` 404s on a fresh clone
until `api:seed` has run. That is expected, not a bug — don't debug it.

**5. Adding any dependency to `apps/mobile` fails with ERESOLVE.**
`@expo/metro-runtime` optionally peers on `react-dom`, npm resolves `19.2.8`, and that demands
`react@^19.2.8` — but the app pins `react@19.1.0`. Pre-existing, not something you broke. Use
`--legacy-peer-deps` for the install and do **not** "fix" it by bumping the app's React.

Related: `npm --prefix apps/mobile install` succeeds on a cold run and then **fails on the
second consecutive run** with the same ERESOLVE. Also pre-existing, verified against an
untouched baseline.

**6. Metro's entry point is `expo-router/entry`, not `index`.**
To force a full bundle compile without a simulator:
```bash
curl "http://localhost:8081/node_modules/expo-router/entry.bundle?platform=ios&dev=true"
```
`/index.bundle` returns 404. That 404 means you used the wrong path, not that Metro is broken.

---

## Changing the data model

Work through these before writing a migration. Each one exists because skipping it has already
cost time on this repo.

**1. Deleting a row destroys every column on it, not just the one you're reasoning about.**
Before making anything delete a row, list that model's columns and grep each one for consumers.
`UserCard` looks like `(userId, cardId, quantity)` until you notice `firstScannedAt`, which the
admin renders as "First collected" *and* sorts the owners list by.

**2. Changing a read is an API change.** `GET /cards` computes `owned: !!uc`. Anything that
alters when rows exist silently alters that endpoint's answer. Grep the field across all four
surfaces — `packages/shared` and `apps/mobile/src/types.ts` are separate copies and both drift.

**3. Pick `onDelete` deliberately.** House style is `Cascade` (`UserCard.card`, `QrCode.card`).
Deviating is fine, but say why in the migration or the PR — a silent `Restrict` will block an
admin flow that already works.

**4. Prisma's DSL doesn't cover everything.** Partial indexes, check constraints, and triggers
have no schema syntax. Generate the migration, then hand-edit the SQL file to append them —
that is supported and normal, not a hack.

**5. Test the migration against a *fresh* database, not just yours.**
`npm run db:reset && npm run api:setup` from the repo root. A migration that applies cleanly to
an already-migrated database can still fail from empty.

**6. Remember `api:migrate` is hardcoded to `--name init`** (quirk 3 above). Use the direct
command.

### While you're at it

Kill processes by **port or PID**, never a broad `pkill -f <name>` — `pkill -f turnapp` matches
the Docker container's process too and will take your database down with your API. Use
`lsof -ti:4000 | xargs kill`. Data survives (the volume is named), but you'll lose time.

---

## Verification

One command runs the whole gate:

```bash
npm run verify   # api typecheck + mobile typecheck + admin build + tests
```

Or individually:

```bash
npm --workspace @turnapp/api run typecheck     # tsc --noEmit, src + prisma + test
npm --prefix apps/mobile run typecheck         # tsc --noEmit
npm --workspace @turnapp/admin run build       # vite build
npm --prefix apps/mobile run test              # jest, no Docker or database
npm --workspace @turnapp/api run test          # vitest, needs both
```

**Generate the Prisma client first on a fresh checkout**, or the API typecheck fails with
around a dozen errors like `Module '"@prisma/client"' has no exported member 'Card'`, plus
cascading implicit-`any`s. They point at source files and read like real type bugs; they are
not. The client is generated into `node_modules`, so a fresh clone or a new worktree has none:

```bash
npm --workspace @turnapp/api run prisma:generate
```

`npm run api:setup` includes this, but running the typecheck before setup does not.

### Tests

`npm test` runs the mobile suite first, then the API's. The API suite runs Vitest against a
**separate test database** on the same container — dev data is never touched. The global setup
runs `prisma migrate reset --force --skip-seed` against that database, which creates it on
first run and rebuilds it from the migration files on every run. Rebuilding rather than
`migrate deploy`-ing is deliberate: `deploy` keys off a migration's *name*, so it ignores the
hand-edits to already-applied migration SQL that "Changing the data model" step 4 tells you to
make.

The API suite's prerequisites are the full cold start, not just Docker: `.env`, `npm install`,
`prisma:generate` (see the note ten lines above), and `npm run db:up`.

**The test database is per checkout, not per repo.** `test/env.ts` appends `_test_<tag>` to the
dev database name, where `<tag>` is the first eight hex digits of a SHA-1 of this worktree's
real path — so the main checkout and each `git worktree` get `turnapp_test_1a2b3c4d`,
`turnapp_test_9f0e1d2c`, and so on:

```bash
docker exec turnapp-db psql -U turn -d postgres -c '\l' | grep turnapp   # who owns what
```

This exists because the global setup **drops the schema**. With one shared `turnapp_test`, two
worktrees running `npm test` at the same time reset each other mid-run, and the victim fails
with `The table public.Season does not exist` — a failure that reads like a code bug and
belongs to another process entirely. Two suites can now run concurrently and neither notices
the other.

Three properties that constrain any change to that derivation:

- **Stable, never fresh.** The tag is a hash of a path, so it is identical on every run from
  the same worktree. A timestamp or a random suffix would make `migrate reset` build and
  abandon a new database on every single run.
- **The safety guard is the `_test_<8 hex>` shape.** `global-setup.ts` refuses to reset a URL
  that doesn't match it, and writes the pattern out itself rather than importing it — the check
  is only worth having if it can disagree with the module that derived the name.
- **Deleting a stale one is free.** The database is a throwaway rebuilt from the migrations;
  after removing a worktree, `docker exec turnapp-db psql -U turn -d postgres -c 'DROP DATABASE
  turnapp_test_<tag>'` reclaims it. Nothing else references it by name.

The suite's readiness polls (`waitForLockWaiters`, and the decline suite's blocked-writer
check) read `pg_stat_activity` filtered on `current_database()`, so per-checkout databases also
stop one worktree's blocked query from satisfying another's wait.

These are integration tests against real Postgres, not unit tests with a mocked Prisma client:
the risk in this codebase is transaction semantics, and a mock would only test the mock. Test
files run sequentially because they share one database and truncate between cases rather than
wrapping in a transaction — the code under test opens its own.

Routes are exercised over HTTP with supertest against the app exported from
`apps/api/src/app.ts`, in-process on an ephemeral port — `src/index.ts` is only the `listen`
call, so importing the app never collides with a dev server on 4000. `test/helpers.ts` has
`api()` and `authedApi(user, method, url)`.

The mobile suite is Jest under the `jest-expo` preset — `npm --prefix apps/mobile run test`,
and now the first half of `npm test`, which is how the gate reaches it. It needs no Docker, no
database and no Metro server: the three files in `apps/mobile/__tests__` exercise pure
functions with `fetch` and `expo-constants` mocked, and render no components. That makes it the
half of the gate that still runs on a machine with nothing else set up. It does need
`npm --prefix apps/mobile install` though — mobile is outside the workspace (quirk 1 above), so
a root-only install leaves `jest` missing.

`api.test.ts` holds the module-private `request` helper to its error, 204 and header behaviour
and pins each card endpoint to resolving `imageUrl`; `config.test.ts` walks the `API_URL`
precedence chain listed under "Networking" and covers `resolveImageUrl`; `rarityColor.test.ts`
covers the rarity palette. Two constraints if you add to it. `API_URL` is computed at module
load, so each case installs its mocks and then `require`s `src/config` — a top-level `import`
would pin whatever the first case loaded and leave the lower tiers of the chain unreachable.
And `request` is reached through the `api` wrappers rather than exported, on the principle that
a test should not widen the surface of the code it measures.

For API behaviour, curl against a running server:

```bash
curl -s localhost:4000/health
T=$(curl -s -X POST localhost:4000/auth/login -H 'content-type: application/json' \
     -d '{"email":"testing@turn.app","password":"turn123"}' | jq -r .token)
curl -s localhost:4000/cards -H "Authorization: Bearer $T"
```

To inspect data directly:

```bash
docker exec turnapp-db psql -U turn -d turnapp -c '\dt'
```

---

## Accounts

Seeded by `apps/api/prisma/seed.ts`.

| Account | Email | Password |
| --- | --- | --- |
| Demo user | `testing@turn.app` | `turn123` |
| Admin | `admin@turn.app` | `admin123` |
| 8 generated users | `<first>.<last><n>@turn.app` | `turn123` |

**All eight generated users share the password `turn123`** (`seed.ts:350`) — so a second real
account is available with no seed changes. Useful pairs for anything involving two users:

| User | Cards owned |
| --- | --- |
| `testing@turn.app` | 8 of 15 |
| `taylor.poole2@turn.app` | 12 of 15 |
| `jamie.reed7@turn.app` | 2 of 15 |

List them all: `docker exec turnapp-db psql -U turn -d turnapp -c 'select email, username from "User";'`

---

## Layout

| Surface | Stack | Path |
| --- | --- | --- |
| Mobile | Expo + React Native + expo-router | `apps/mobile` |
| API | Express + Prisma + TypeScript | `apps/api` |
| Admin | React + Vite | `apps/admin` |
| Shared types | plain TypeScript | `packages/shared` |
| DB | Postgres 16 in Docker | `docker-compose.yml` |

The API is small: every user-facing endpoint lives in `apps/api/src/routes/app.ts` (143 lines).
Admin routes are in `routes/admin.ts`. Total API source is ~610 lines.

### A feature touches five layers, in this order

1. `apps/api/prisma/schema.prisma` → then migrate (see quirk 3)
2. `apps/api/src/routes/app.ts` → wired in `apps/api/src/index.ts`
3. `packages/shared/src/index.ts` → **and mirror into `apps/mobile/src/types.ts`**
4. `apps/mobile/app/` (file-based routing) + a call in `apps/mobile/src/api.ts`
5. `apps/admin/src/pages/` (optional)

### Reference implementation

**Scan-to-collect is a complete vertical slice — read it before writing anything.**

`QrCode` model → `POST /scan` (`routes/app.ts:51`) → `packages/shared` → `apps/mobile/src/api.ts`
→ `apps/mobile/app/scan-camera.tsx` → admin QR management.

It also establishes the codebase's concurrency idiom: put the precondition in the `where` of an
`updateMany` and check `count === 0`, rather than read-then-write. Reuse that pattern for any
state transition that must not double-apply.

---

## Conventions

- **Serialization goes through `apps/api/src/serialize.ts`.** Never return Prisma models
  directly. `toPublicCard` rewrites `imageUrl` into the relative `/static/cards/...` path that
  clients resolve against their own host — skip it and images break on physical devices.
- **Never leak `email` or `passwordHash`.** `toPublicUser` exists; use it.
- **Errors are `{ "error": "message" }`.** The mobile client (`apps/mobile/src/api.ts`) throws
  `body.error` directly to the UI, so error strings are user-facing copy. Write them that way.
  Say it in the route, with an explicit `res.status(...).json({ error })` — the error middleware
  in `app.ts` answers a fixed sentence and never returns `err.message`, because a Prisma
  rejection's message carries the failing query and an absolute path into the source tree.
- **Every router is `asyncRouter()` from `src/async-router.ts`, never `express.Router()`.**
  Express 4 ignores the promise an `async` handler returns, so a rejection inside one is an
  unhandled rejection and Node 20 exits the process — one malformed request takes the API down
  for everybody. `asyncRouter` wraps at registration so the boundary can't be forgotten a
  handler at a time, but it is opt-in per router: a plain `Router()` silently has none of it.
  Every router in `src/routes` is one, `routes/trades.ts` included — it was converted on
  `feat/th7-accept-trade`. `test/async-boundary.test.ts` is what keeps a new one honest.
- **Auth**: `appRouter` is entirely behind `requireAuth`; `req.auth.userId` is the caller.
  Never take an actor identity from the request body.
- **Validation is hand-rolled.** No zod or equivalent — match the existing inline
  `if (!x) return res.status(400).json({ error: ... })` style.
- Shared types are duplicated by design between `packages/shared` and `apps/mobile/src/types.ts`
  (mobile is outside the workspace). Change both.

---

## Commits

This repo follows [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/).

```
<type>(<scope>): <description>

<body — why, not what>
```

**Rules**

- Imperative mood: `add trade endpoint`, not `added` or `adds`
- Lowercase description, no trailing period
- Subject line under ~72 characters
- Body optional, but expected for anything non-obvious. Explain *why* — the diff already
  shows *what*.
- Breaking changes: `!` before the colon, or a `BREAKING CHANGE:` footer

**Types**

| Type | Use for |
| --- | --- |
| `feat` | a new capability |
| `fix` | a bug fix |
| `docs` | documentation only |
| `refactor` | behaviour-preserving restructure |
| `perf` | performance work |
| `test` | tests only |
| `build` | dependencies, tooling, build config |
| `chore` | everything else, no src change |

**Scopes**

| Scope | Covers |
| --- | --- |
| `db` | `apps/api/prisma` — schema, migrations, seed |
| `api` | `apps/api/src` |
| `shared` | `packages/shared` |
| `mobile` | `apps/mobile` |
| `admin` | `apps/admin` |
| *(omit)* | repo-wide: tooling, onboarding docs, CI |

Use a feature name as the scope (e.g. `trading`) when a change spans several of the above and
the feature is the clearer unit.

**Examples**

```
feat(db): add Trade model, TradeStatus enum, and migration
feat(api): swap cards atomically on trade acceptance
fix(mobile): resolve card image paths against the Expo dev host
docs: add AGENTS.md with cold-start, quirks, and verification gate
```

**Commit as you go** — one commit per logical unit, not one per session. The history should
read as the build order.

---

## Networking

`apps/mobile/src/config.ts` derives the API host from the Expo dev server's host, so a physical
phone on the same Wi-Fi reaches the API with no per-machine config. Override precedence:

1. `EXPO_PUBLIC_API_URL` if set
2. Expo dev-server host + port 4000
3. `localhost:4000` (iOS sim) / `10.0.2.2:4000` (Android emulator)

Ports: API 4000, admin 5173, Postgres 5432, Expo 8081. Vite and Expo silently fall through to
the next free port if taken, so confirm the port in their startup output rather than assuming.

---

## Teardown

```bash
npm run db:down     # stops and removes the container; the pgdata volume SURVIVES
npm run db:reset    # drops the volume too — full fresh DB, requires re-running api:setup
```

Because the volume persists, `npm run db:up` restores seeded state. `api:setup` is only needed
on a new machine or after `db:reset`.
