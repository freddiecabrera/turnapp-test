import path from "path";
import express from "express";
import cors from "cors";
import { env } from "./env";
import { authRouter } from "./routes/auth";
import { appRouter } from "./routes/app";
import { adminRouter } from "./routes/admin";

const app = express();

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

app.listen(env.port, () => {
  console.log(`turn api listening on ${env.publicApiUrl} (port ${env.port})`);
});
