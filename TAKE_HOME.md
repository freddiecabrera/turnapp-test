# turn — Take-Home Challenge: Card Trading

Welcome, and thanks for taking the time to work on this. This repo is a simplified but
realistic mock of the **turn** collectibles app — a full-stack slice across a React Native
(Expo) mobile app, a Node/Express + Prisma API, a React admin dashboard, and a Postgres
database.

Your task is to design and build **one feature end-to-end: card trading between users.**

> This document describes **what** to build and how we'll evaluate it — not **how** to build
> it. The design decisions are yours; that's exactly what we want to see.

---

## Before you start

1. **Fork this repository** to your own GitHub account (see submission instructions below).
2. Follow [`README.md`](README.md) to get everything running locally (Docker Postgres, API,
   admin, and the mobile app in Expo Go or a simulator).
3. Skim the codebase. The **scan-to-collect** feature (mobile camera → `POST /scan` → admin
   QR management) is a complete vertical slice you can use as a reference for how a feature
   flows through the database, API, shared types, and mobile app.

You'll need **at least two user accounts** to test trading. The seed
([`apps/api/prisma/seed.ts`](apps/api/prisma/seed.ts)) creates a demo user plus several
others; feel free to add a second known account to make testing easier.

---

## The feature: card trading

**User story:** _As a collector, I want to trade cards with other users so I can complete my
collection._

Build the following flow:

### 1. Trading board
- A place in the **mobile app** where a signed-in user can see **their trades** — both trades
  they've **sent** and trades they've **received** — each with a clear **status** (e.g.
  pending, accepted, declined).
- From here, the user can start a **new trade**.

### 2. Create a trade
Creating a trade walks the user through:
1. **Choose who to trade with** — look up / search for another user.
2. **Choose what you're offering** — pick a card from **your own** collection.
3. **Choose what you want in return** — pick a card from the **other user's** collection
   (you should only be able to request a card that user actually owns).
4. **Send the request.**

### 3. Notify & approve
- The other user is **notified** that they have a pending incoming trade request.
- They can **review** the request (what's being offered vs. requested) and **approve or
  decline** it.
- A trade only goes through **after the recipient approves** it.

### 4. Complete the trade
- On approval, the two cards **swap** between the collections: the offered card moves from the
  sender to the recipient, and the requested card moves from the recipient to the sender.
- Both users' trading boards and collections reflect the result.

---

## Requirements & acceptance criteria

Your solution should:

- [ ] Let a user create a trade request targeting another user, offering one of their cards
      for one of the target user's cards.
- [ ] Only allow offering cards the sender **owns**, and only allow requesting cards the
      recipient **owns**, at request time.
- [ ] Prevent invalid trades (e.g. trading with yourself, offering/requesting a card that
      isn't owned).
- [ ] Show the recipient a pending request and require their **explicit approval** before any
      cards move.
- [ ] On approval, **atomically** move the cards between the two collections and mark the
      trade complete. On decline, nothing changes.
- [ ] Correctly handle **quantities** (a user who owned a single copy no longer owns it after
      trading it away; duplicates are handled sensibly).
- [ ] Reflect trade status on both users' trading boards.

**"Notified"** can be as simple as the request appearing in the recipient's trading board as a
pending incoming trade. Real push notifications are **not** required (though a note on how
you'd add them is welcome).

---

## Scope

**In scope**
- A single card-for-single-card trade is enough.
- Full vertical slice: database (Prisma schema + migration), API (Express routes + shared
  types), and the mobile app (Expo). Use the existing auth, patterns, and styling.

**Out of scope** (don't spend time here unless you want to)
- Multi-card bundles, points/payment in trades, trade expiry, real-time updates, chat, and
  admin-side trade management. If you have ideas, mention them in your write-up instead of
  building them.

---

## How we'll evaluate

We care about how you think and how you work in an unfamiliar codebase, roughly:

| Area | What we look for |
| --- | --- |
| **Correctness** | The full flow works and the edge cases above are handled. |
| **Data & API design** | Sensible schema and endpoints; clear ownership of state transitions. |
| **Code quality** | Readable, consistent with the existing codebase, well-structured. |
| **Robustness** | Validation, error handling, and safe (atomic) state changes. |
| **Mobile UX** | The create-trade and approval flows are clear and pleasant to use. |
| **Communication** | Clear commits and a short write-up of your decisions and trade-offs. |

We value a **well-scoped, polished, correct** slice over a broad, half-finished one. Quality
over quantity.

---

## Submitting your work

1. Implement your feature on a **branch in your fork**.
2. Commit as you go with clear messages.
3. **Push to your own repository** and send us the **link**.
4. Include a short write-up (in a `SOLUTION.md` or your PR description) covering:
   - What you built and how to run/test it.
   - Key decisions and trade-offs.
   - What you'd do with more time.

That's it — good luck, and have fun with it. If anything about the setup is broken or
unclear, note it; adapting to a new dev environment is part of the exercise.
