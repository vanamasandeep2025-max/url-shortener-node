import path from "node:path";
import express, { Express } from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import { env } from "./lib/env";
import { logger } from "./lib/logger";
import { urlsRouter } from "./routes/urls";
import { redirectRouter } from "./routes/redirect";
import { healthRouter } from "./routes/health";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler";

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.corsAllowedOrigins }));
  app.use(express.json({ limit: "10kb" }));
  app.use(pinoHttp({ logger, autoLogging: env.NODE_ENV !== "test" }));

  app.use("/health", healthRouter);
  app.use("/api/urls", urlsRouter);
  // Manual test UI only -- talks to the API above over fetch(). Mounted under /ui
  // (not "/") so it can never collide with the redirect catch-all route below.
  app.use("/ui", express.static(path.join(__dirname, "../public")));
  app.use("/", redirectRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
