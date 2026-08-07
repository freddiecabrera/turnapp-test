import path from "path";
import dotenv from "dotenv";

// Single source of truth: the repo-root .env file (copied from .env.example).
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const env = {
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET", "dev-super-secret-change-me"),
  port: Number(required("PORT", "4000")),
  publicApiUrl: required("PUBLIC_API_URL", "http://localhost:4000"),
};
