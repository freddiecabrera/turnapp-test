import path from "path";
import express from "express";
import cors from "cors";
import { authRouter } from "./routes/auth";
import { appRouter } from "./routes/app";
import { adminRouter } from "./routes/admin";
import { usersRouter } from "./routes/users";

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
// Mounted last as a preference, not a requirement. `appRouter` sits on "/" and
// runs `requireAuth` for everything reaching it, but `requireAuth` calls
// `next()` and none of `appRouter`'s own routes match `/users/...`, so the
// request falls out of that router and Express carries on to the next layer
// whichever order they mount in. Specific paths first just avoids running
// `requireAuth` twice, and keeps an anonymous 401 coming from the owning router.
app.use("/", appRouter);

// Basic error handler so multer / async errors return JSON.
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal server error" });
});
