import { createApp } from "./app";
import { env } from "./lib/env";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { redis } from "./lib/redis";

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info(`url-shortener listening on port ${env.PORT}`);
});

async function shutdown(signal: string) {
  logger.info(`received ${signal}, shutting down gracefully`);
  server.close(async () => {
    await prisma.$disconnect();
    redis.disconnect();
    process.exit(0);
  });
  // Force-exit if connections don't drain in time, so a stuck shutdown never hangs a container.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
