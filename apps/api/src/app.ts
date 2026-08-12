import path from "path";
import express from "express";
import cors from "cors";
import { authRouter } from "./routes/auth";
import { appRouter } from "./routes/app";
import { adminRouter } from "./routes/admin";
import { usersRouter } from "./routes/users";
import { tradesRouter } from "./routes/trades";

/**
 * The configured Express app, with no server attached.
 *
 * Separate from `index.ts` so tests can drive the real routing stack in-process
 * via supertest. Importing `index.ts` would call `listen` as a side effect of
 * the import and fight the dev server for port 4000.
 */
export const app = express();

app.use(cors());
app.use(express.json());

// Static card images (served to the mobile app + admin).
app.use("/static/cards", express.static(path.resolve(__dirname, "../static/cards")));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRouter);
app.use("/admin", adminRouter);
app.use("/users", usersRouter);
app.use("/trades", tradesRouter);
// Mounted last as a preference, not a requirement. `appRouter` sits on "/" and
// runs `requireAuth` for everything reaching it, but `requireAuth` calls
// `next()` and none of `appRouter`'s own routes match `/users/...` or
// `/trades/...`, so the request falls out of that router and Express carries on
// to the next layer whichever order they mount in. Specific paths first just
// avoids running `requireAuth` twice, and keeps an anonymous 401 coming from the
// router that owns the path.
app.use("/", appRouter);

/**
 * What a client is told when a request fails in a way no route anticipated.
 *
 * Fixed text, because the only errors reaching here are ones nothing planned
 * for — there is nothing true to say about them that is also safe to say. It
 * still reads as copy rather than a code, since the mobile client throws
 * `body.error` straight to the UI (see AGENTS.md, "Conventions").
 */
const GENERIC_500 = "Something went wrong on our end. Please try again.";

/**
 * Last-resort handler so multer / async errors return JSON instead of Express's
 * HTML stack trace.
 *
 * `err.message` is deliberately **not** returned. Every message that belongs to
 * a user is already sent by its route as an explicit `res.status(...).json(...)`;
 * what arrives here instead is the unplanned kind, and those messages describe
 * the server. Prisma's are the worst case — a rejected query stringifies to the
 * failing call, an absolute path into the source tree, and the surrounding
 * lines of that file — and since `asyncRouter` began routing rejections here,
 * that was reachable anonymously through `POST /auth/login` with a null byte in
 * the email. Fixing the crash must not have cost a disclosure to do it.
 *
 * The detail is not discarded, only kept on this side of the wire: `console.error`
 * still logs the whole error, stack included, for whoever is running the server.
 */
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: GENERIC_500 });
});
