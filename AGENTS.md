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

## The five things that will trip you up

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

**5. Metro's entry point is `expo-router/entry`, not `index`.**
To force a full bundle compile without a simulator:
```bash
curl "http://localhost:8081/node_modules/expo-router/entry.bundle?platform=ios&dev=true"
```
`/index.bundle` returns 404. That 404 means you used the wrong path, not that Metro is broken.

---

## Verification

**There is no test runner in this repo** — no `test` script in any workspace, no lint config.
Do not go looking for one. The available verification surface is:

```bash
npm --workspace @turnapp/api run typecheck     # tsc --noEmit
npm --prefix apps/mobile run typecheck         # tsc --noEmit
npm --workspace @turnapp/admin run build       # vite build
```

All three pass on a clean checkout. Treat them as the regression gate.

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
