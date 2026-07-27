// Runs before each test file's modules are loaded, so env.ts (which uses
// dotenv, and never overrides already-set vars) picks these up instead of `.env`.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://urlshortener:urlshortener@localhost:5432/urlshortener_test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.PUBLIC_BASE_URL = "http://localhost:3000";
process.env.CORS_ALLOWED_ORIGINS = "http://localhost:3000";
process.env.RATE_LIMIT_POINTS = "100000";
process.env.RATE_LIMIT_WINDOW_SECONDS = "60";
