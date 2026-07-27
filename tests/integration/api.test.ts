import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import { prisma } from "../../src/lib/prisma";

let app: Express;

beforeAll(() => {
  app = createApp();
});

beforeEach(async () => {
  await prisma.clickEvent.deleteMany();
  await prisma.shortUrl.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function waitForClickCount(code: string, expected: number, attempts = 20): Promise<{ totalClicks: number }> {
  for (let i = 0; i < attempts; i++) {
    const res = await request(app).get(`/api/urls/${code}/stats`);
    if (res.body.totalClicks >= expected) return res.body;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`click count for ${code} never reached ${expected}`);
}

describe("POST /api/urls", () => {
  it("creates a short URL with a generated code", async () => {
    const res = await request(app).post("/api/urls").send({ url: "https://example.com" });
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^[0-9A-Za-z]{7}$/);
    expect(res.body.shortUrl).toBe(`http://localhost:3000/${res.body.code}`);
  });

  it("rejects a non-http(s) URL with 400", async () => {
    const res = await request(app).post("/api/urls").send({ url: "javascript:alert(1)" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });

  it("rejects malformed JSON with 400, not 500", async () => {
    const res = await request(app).post("/api/urls").set("Content-Type", "application/json").send("{not-json");
    expect(res.status).toBe(400);
  });

  it("rejects a missing url field with 400", async () => {
    const res = await request(app).post("/api/urls").send({});
    expect(res.status).toBe(400);
  });

  it("supports a custom alias and 409s when it's already taken", async () => {
    const first = await request(app)
      .post("/api/urls")
      .send({ url: "https://example.com", customAlias: "my-alias" });
    expect(first.status).toBe(201);
    expect(first.body.code).toBe("my-alias");

    const second = await request(app)
      .post("/api/urls")
      .send({ url: "https://example.org", customAlias: "my-alias" });
    expect(second.status).toBe(409);
  });

  it("rejects an expiresAt that is not in the future", async () => {
    const res = await request(app)
      .post("/api/urls")
      .send({ url: "https://example.com", expiresAt: "2020-01-01T00:00:00Z" });
    expect(res.status).toBe(400);
  });
});

describe("GET /:code (redirect)", () => {
  it("redirects to the long URL and records a click asynchronously", async () => {
    const create = await request(app).post("/api/urls").send({ url: "https://example.com/target" });
    const code = create.body.code;

    const redirect = await request(app).get(`/${code}`).set("Referer", "https://ref.example");
    expect(redirect.status).toBe(302);
    expect(redirect.headers.location).toBe("https://example.com/target");

    const stats = await waitForClickCount(code, 1);
    expect(stats.totalClicks).toBe(1);
  });

  it("returns 404 for an unknown code", async () => {
    const res = await request(app).get("/doesnotexist");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 410 for a soft-deleted code", async () => {
    const create = await request(app).post("/api/urls").send({ url: "https://example.com" });
    const code = create.body.code;

    await request(app).delete(`/api/urls/${code}`).expect(204);
    const res = await request(app).get(`/${code}`);
    expect(res.status).toBe(410);
  });

  it("returns 410 for an expired code", async () => {
    const record = await prisma.shortUrl.create({
      data: { code: "expired1", longUrl: "https://example.com", expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await request(app).get(`/${record.code}`);
    expect(res.status).toBe(410);
  });
});

describe("GET /api/urls/:code/stats", () => {
  it("returns 404 for an unknown code", async () => {
    const res = await request(app).get("/api/urls/doesnotexist/stats");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/urls", () => {
  it("lists created URLs with pagination", async () => {
    await request(app).post("/api/urls").send({ url: "https://example.com/1" });
    await request(app).post("/api/urls").send({ url: "https://example.com/2" });

    const res = await request(app).get("/api/urls?limit=1&offset=0");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.total).toBe(2);
  });

  it("excludes soft-deleted links when includeInactive=false (the default)", async () => {
    const create = await request(app).post("/api/urls").send({ url: "https://example.com/to-delete" });
    await request(app).delete(`/api/urls/${create.body.code}`);

    const withoutInactive = await request(app).get("/api/urls?includeInactive=false");
    expect(withoutInactive.body.items.find((i: { code: string }) => i.code === create.body.code)).toBeUndefined();

    const withInactive = await request(app).get("/api/urls?includeInactive=true");
    expect(withInactive.body.items.find((i: { code: string }) => i.code === create.body.code)).toBeDefined();
  });
});

describe("DELETE /api/urls/:code", () => {
  it("returns 404 for an unknown code", async () => {
    const res = await request(app).delete("/api/urls/doesnotexist");
    expect(res.status).toBe(404);
  });
});

describe("GET /health", () => {
  it("reports the database as ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.checks.database).toBe("ok");
  });
});
