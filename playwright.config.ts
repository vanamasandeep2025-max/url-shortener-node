import { defineConfig, devices } from "@playwright/test";

// Same DB the Jest integration suite uses -- already migrated. Do not point
// this at the dev DB (.env's `urlshortener`): that one carries demo data for
// manual exploration and e2e runs would create/soft-delete rows in it.
const DATABASE_URL = "postgresql://urlshortener:urlshortener@localhost:5432/urlshortener_test";

// Ports deliberately different from 3000, which is where a developer may already
// have `npm start` running for manual exploration via /ui -- these must never collide.
const APP_PORT = 3100;
const RATE_LIMIT_PORT = 3200;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  // "list" prints live progress in the terminal; "html" produces a browsable
  // report (screenshots/traces per test) opened afterwards with `npx playwright show-report`.
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 45_000,
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // Slows down each browser action so a headed run can be watched visually
    // (does not affect direct API calls made via the `request` fixture, e.g.
    // the rate-limit test's request bursts).
    launchOptions: { slowMo: 750 },
  },
  projects: [
    {
      // Every spec except the dedicated rate-limit test, which needs its own
      // low-quota server so it can't starve (or be starved by) anything else.
      name: "app",
      testMatch: /^(?!.*rate-limit).*\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"], channel: "chrome", baseURL: `http://localhost:${APP_PORT}` },
    },
    {
      name: "rate-limit",
      testMatch: /rate-limit\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"], channel: "chrome", baseURL: `http://localhost:${RATE_LIMIT_PORT}` },
    },
  ],
  webServer: [
    {
      command: "node dist/server.js",
      url: `http://localhost:${APP_PORT}/health`,
      reuseExistingServer: false,
      timeout: 20_000,
      env: {
        PORT: String(APP_PORT),
        NODE_ENV: "test",
        DATABASE_URL,
        // DB index 0: kept separate from the rate-limit project's DB 1 below. With a real
        // Redis now available, both projects' rate-limiter keys would otherwise collide on
        // the same client IP (rate-limiter-flexible's Redis key isn't port-scoped), which
        // would make the dedicated low-quota rate-limit test flaky/meaningless.
        REDIS_URL: "redis://localhost:6379/0",
        PUBLIC_BASE_URL: `http://localhost:${APP_PORT}`,
        CORS_ALLOWED_ORIGINS: `http://localhost:${APP_PORT}`,
        RATE_LIMIT_POINTS: "100",
        RATE_LIMIT_WINDOW_SECONDS: "60",
      },
    },
    {
      command: "node dist/server.js",
      url: `http://localhost:${RATE_LIMIT_PORT}/health`,
      reuseExistingServer: false,
      timeout: 20_000,
      env: {
        PORT: String(RATE_LIMIT_PORT),
        NODE_ENV: "test",
        DATABASE_URL,
        REDIS_URL: "redis://localhost:6379/1",
        PUBLIC_BASE_URL: `http://localhost:${RATE_LIMIT_PORT}`,
        CORS_ALLOWED_ORIGINS: `http://localhost:${RATE_LIMIT_PORT}`,
        RATE_LIMIT_POINTS: "3",
        RATE_LIMIT_WINDOW_SECONDS: "60",
      },
    },
  ],
});
