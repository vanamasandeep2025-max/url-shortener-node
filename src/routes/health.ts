import { Router } from "express";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  const checks: Record<string, "ok" | "down"> = { database: "down", cache: "down" };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch {
    checks.database = "down";
  }

  try {
    await redis.ping();
    checks.cache = "ok";
  } catch {
    checks.cache = "down";
  }

  // The cache is optional infrastructure (see urlService's fail-open handling), so
  // only the database being down makes the service actually unhealthy.
  const healthy = checks.database === "ok";
  res.status(healthy ? 200 : 503).json({ status: healthy ? "ok" : "degraded", checks });
});
