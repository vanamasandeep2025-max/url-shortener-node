import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000"),
  CORS_ALLOWED_ORIGINS: z.string().default("http://localhost:3000"),
  RATE_LIMIT_POINTS: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  // Signs the short-lived "already unlocked this password-protected link" cookie.
  // Dev default is fine locally; must be overridden with a real secret in production.
  LINK_UNLOCK_SECRET: z.string().min(1).default("dev-only-unlock-secret-change-me"),
  LINK_UNLOCK_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  UNLOCK_RATE_LIMIT_POINTS: z.coerce.number().int().positive().default(10),
  UNLOCK_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(300),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  corsAllowedOrigins: parsed.data.CORS_ALLOWED_ORIGINS.split(",").map((o) => o.trim()),
};
