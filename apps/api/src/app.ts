import path from "path";
import express from "express";
import cors from "cors";
import { authRouter } from "./routes/auth";
import { appRouter } from "./routes/app";
import { adminRouter } from "./routes/admin";

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
app.use("/", appRouter);

// Basic error handler so multer / async errors return JSON.
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal server error" });
});
