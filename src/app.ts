import path from "node:path";
import express, { Express } from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { env } from "./lib/env";
import { logger } from "./lib/logger";
import { urlsRouter } from "./routes/urls";
import { redirectRouter } from "./routes/redirect";
import { healthRouter } from "./routes/health";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler";

export function createApp(): Express {
  const app = express();

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          // Helmet's default `form-action 'self'` blocks not just where a <form> can
          // POST to, but also any cross-origin redirect a server sends in response to
          // that POST -- which silently breaks the password-unlock form's whole job
          // (redirecting to the link's arbitrary http(s) destination) whenever that
          // destination isn't this app's own origin. This app's entire product is an
          // intentional open redirect to arbitrary http(s) URLs (see
          // engineering-summary.md's "Open redirect by design" note), so restricting
          // form-action to 'self' was never actually the intended security boundary.
          "form-action": ["'self'", "https:", "http:"],
        },
      },
    }),
  );
  app.use(cors({ origin: env.corsAllowedOrigins }));
  app.use(express.json({ limit: "10kb" }));
  // Needed for the password-protected-link unlock form, a plain HTML <form> POST
  // (works without JavaScript) rather than a fetch() call.
  app.use(express.urlencoded({ extended: false, limit: "1kb" }));
  app.use(cookieParser());
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
