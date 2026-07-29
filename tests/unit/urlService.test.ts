import { Prisma } from "@prisma/client";
import { BadRequestError, ConflictError, GoneError, NotFoundError, ServiceUnavailableError } from "../../src/errors";
import { prisma } from "../../src/lib/prisma";
import { redis } from "../../src/lib/redis";

jest.mock("../../src/lib/prisma", () => ({
  prisma: {
    shortUrl: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    clickEvent: {
      create: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

jest.mock("../../src/lib/redis", () => ({
  redis: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  },
}));

import {
  createShortUrl,
  getRedirectTarget,
  getStats,
  recordClick,
  softDeleteUrl,
  verifyLinkPassword,
} from "../../src/services/urlService";

function uniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`code`)", {
    code: "P2002",
    clientVersion: "5.20.0",
  });
}

const baseRecord = {
  id: 1,
  code: "abc1234",
  longUrl: "https://example.com",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  expiresAt: null as Date | null,
  isActive: true,
  passwordHash: null as string | null,
};

describe("createShortUrl", () => {
  beforeEach(() => {
    (redis.get as jest.Mock).mockResolvedValue(null);
    (redis.set as jest.Mock).mockResolvedValue("OK");
  });

  it("rejects an invalid long URL before touching the database", async () => {
    await expect(createShortUrl({ longUrl: "javascript:alert(1)" })).rejects.toBeInstanceOf(BadRequestError);
    expect(prisma.shortUrl.create).not.toHaveBeenCalled();
  });

  it("rejects an expiresAt that isn't in the future", async () => {
    await expect(
      createShortUrl({ longUrl: "https://example.com", expiresAt: "2020-01-01T00:00:00Z" }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("creates a short URL with a generated code", async () => {
    (prisma.shortUrl.create as jest.Mock).mockResolvedValueOnce(baseRecord);

    const result = await createShortUrl({ longUrl: "https://example.com" });

    expect(result.code).toBe("abc1234");
    expect(result.shortUrl).toBe("http://localhost:3000/abc1234");
    expect(prisma.shortUrl.create).toHaveBeenCalledTimes(1);
  });

  it("retries on a code collision and succeeds on the next attempt", async () => {
    (prisma.shortUrl.create as jest.Mock)
      .mockRejectedValueOnce(uniqueConstraintError())
      .mockResolvedValueOnce(baseRecord);

    const result = await createShortUrl({ longUrl: "https://example.com" });

    expect(result.code).toBe("abc1234");
    expect(prisma.shortUrl.create).toHaveBeenCalledTimes(2);
  });

  it("gives up after repeated collisions", async () => {
    (prisma.shortUrl.create as jest.Mock).mockRejectedValue(uniqueConstraintError());

    await expect(createShortUrl({ longUrl: "https://example.com" })).rejects.toBeInstanceOf(ServiceUnavailableError);
  });

  it("rejects a malformed custom alias", async () => {
    await expect(createShortUrl({ longUrl: "https://example.com", customAlias: "a" })).rejects.toBeInstanceOf(
      BadRequestError,
    );
    expect(prisma.shortUrl.create).not.toHaveBeenCalled();
  });

  it("returns 409 when a custom alias is already taken", async () => {
    (prisma.shortUrl.create as jest.Mock).mockRejectedValueOnce(uniqueConstraintError());

    await expect(
      createShortUrl({ longUrl: "https://example.com", customAlias: "taken-alias" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("hashes a provided password before it ever reaches the database", async () => {
    (prisma.shortUrl.create as jest.Mock).mockImplementationOnce(({ data }) =>
      Promise.resolve({ ...baseRecord, passwordHash: data.passwordHash }),
    );

    const result = await createShortUrl({ longUrl: "https://example.com", password: "correct-horse" });

    const createArgs = (prisma.shortUrl.create as jest.Mock).mock.calls[0][0];
    expect(createArgs.data.passwordHash).toEqual(expect.any(String));
    expect(createArgs.data.passwordHash).not.toBe("correct-horse");
    expect(result.hasPassword).toBe(true);
    // Never leak the hash itself in the API-facing DTO.
    expect(result).not.toHaveProperty("passwordHash");
  });

  it("rejects a password shorter than the minimum length", async () => {
    await expect(createShortUrl({ longUrl: "https://example.com", password: "abc" })).rejects.toBeInstanceOf(
      BadRequestError,
    );
    expect(prisma.shortUrl.create).not.toHaveBeenCalled();
  });

  it("rejects a password longer than bcrypt's 72-byte limit", async () => {
    await expect(
      createShortUrl({ longUrl: "https://example.com", password: "x".repeat(73) }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("reports hasPassword: false when no password is given", async () => {
    (prisma.shortUrl.create as jest.Mock).mockResolvedValueOnce(baseRecord);
    const result = await createShortUrl({ longUrl: "https://example.com" });
    expect(result.hasPassword).toBe(false);
  });
});

describe("verifyLinkPassword", () => {
  it("returns false when the link doesn't exist", async () => {
    (prisma.shortUrl.findUnique as jest.Mock).mockResolvedValueOnce(null);
    await expect(verifyLinkPassword("missing", "anything")).resolves.toBe(false);
  });

  it("returns false when the link has no password set", async () => {
    (prisma.shortUrl.findUnique as jest.Mock).mockResolvedValueOnce(baseRecord);
    await expect(verifyLinkPassword("abc1234", "anything")).resolves.toBe(false);
  });

  it("returns false for a soft-deleted link even with the right password", async () => {
    (prisma.shortUrl.findUnique as jest.Mock).mockResolvedValueOnce({
      ...baseRecord,
      isActive: false,
      passwordHash: "$2a$10$abcdefghijklmnopqrstuuC0z8h6l6qk5h0Zt5m1i6oQ9nF6cGZW6",
    });
    await expect(verifyLinkPassword("abc1234", "correct-horse")).resolves.toBe(false);
  });

  it("returns false for an expired link even with the right password", async () => {
    (prisma.shortUrl.findUnique as jest.Mock).mockResolvedValueOnce({
      ...baseRecord,
      expiresAt: new Date("2020-01-01T00:00:00Z"),
      passwordHash: "$2a$10$abcdefghijklmnopqrstuuC0z8h6l6qk5h0Zt5m1i6oQ9nF6cGZW6",
    });
    await expect(verifyLinkPassword("abc1234", "correct-horse")).resolves.toBe(false);
  });

  it("round-trips a real hash: correct password verifies, wrong password doesn't", async () => {
    (prisma.shortUrl.create as jest.Mock).mockImplementationOnce(({ data }) =>
      Promise.resolve({ ...baseRecord, passwordHash: data.passwordHash }),
    );
    await createShortUrl({ longUrl: "https://example.com", password: "correct-horse" });
    const storedHash = (prisma.shortUrl.create as jest.Mock).mock.calls[0][0].data.passwordHash;

    (prisma.shortUrl.findUnique as jest.Mock).mockResolvedValueOnce({ ...baseRecord, passwordHash: storedHash });
    await expect(verifyLinkPassword("abc1234", "correct-horse")).resolves.toBe(true);

    (prisma.shortUrl.findUnique as jest.Mock).mockResolvedValueOnce({ ...baseRecord, passwordHash: storedHash });
    await expect(verifyLinkPassword("abc1234", "wrong-password")).resolves.toBe(false);
  });
});

describe("getRedirectTarget", () => {
  beforeEach(() => {
    (redis.set as jest.Mock).mockResolvedValue("OK");
  });

  it("returns the target from a cache hit without querying the database", async () => {
    (redis.get as jest.Mock).mockResolvedValueOnce(
      JSON.stringify({ id: 1, longUrl: "https://example.com", isActive: true, expiresAt: null, hasPassword: false }),
    );

    const result = await getRedirectTarget("abc1234");

    expect(result).toEqual({ shortUrlId: 1, longUrl: "https://example.com", hasPassword: false });
    expect(prisma.shortUrl.findUnique).not.toHaveBeenCalled();
  });

  it("throws Gone for a cached but soft-deleted entry", async () => {
    (redis.get as jest.Mock).mockResolvedValueOnce(
      JSON.stringify({ id: 1, longUrl: "https://example.com", isActive: false, expiresAt: null, hasPassword: false }),
    );

    await expect(getRedirectTarget("abc1234")).rejects.toBeInstanceOf(GoneError);
  });

  it("falls back to the database on a cache miss and populates the cache", async () => {
    (redis.get as jest.Mock).mockResolvedValueOnce(null);
    (prisma.shortUrl.findUnique as jest.Mock).mockResolvedValueOnce(baseRecord);

    const result = await getRedirectTarget("abc1234");

    expect(result).toEqual({ shortUrlId: 1, longUrl: "https://example.com", hasPassword: false });
    expect(redis.set).toHaveBeenCalled();
  });

  it("reports hasPassword: true for a password-protected link", async () => {
    (redis.get as jest.Mock).mockResolvedValueOnce(null);
    (prisma.shortUrl.findUnique as jest.Mock).mockResolvedValueOnce({ ...baseRecord, passwordHash: "$2a$10$fixture" });

    const result = await getRedirectTarget("abc1234");

    expect(result.hasPassword).toBe(true);
  });

  it("throws NotFound when the code doesn't exist", async () => {
    (redis.get as jest.Mock).mockResolvedValueOnce(null);
    (prisma.shortUrl.findUnique as jest.Mock).mockResolvedValueOnce(null);

    await expect(getRedirectTarget("missing")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws Gone for an expired link found in the database", async () => {
    (redis.get as jest.Mock).mockResolvedValueOnce(null);
    (prisma.shortUrl.findUnique as jest.Mock).mockResolvedValueOnce({
      ...baseRecord,
      expiresAt: new Date("2020-01-01T00:00:00Z"),
    });

    await expect(getRedirectTarget("abc1234")).rejects.toBeInstanceOf(GoneError);
  });

  it("still resolves the redirect when Redis is unavailable (fail-open)", async () => {
    (redis.get as jest.Mock).mockRejectedValueOnce(new Error("connection refused"));
    (prisma.shortUrl.findUnique as jest.Mock).mockResolvedValueOnce(baseRecord);

    const result = await getRedirectTarget("abc1234");

    expect(result.longUrl).toBe("https://example.com");
  });
});

describe("recordClick", () => {
  it("swallows database errors instead of throwing", async () => {
    (prisma.clickEvent.create as jest.Mock).mockRejectedValueOnce(new Error("db down"));

    await expect(recordClick(1, { referrer: "https://ref.example" })).resolves.toBeUndefined();
  });

  it("hashes the IP instead of storing it raw", async () => {
    (prisma.clickEvent.create as jest.Mock).mockResolvedValueOnce({});

    await recordClick(1, { ip: "203.0.113.7" });

    const args = (prisma.clickEvent.create as jest.Mock).mock.calls[0][0];
    expect(args.data.ipHash).toBeDefined();
    expect(args.data.ipHash).not.toBe("203.0.113.7");
  });
});

describe("getStats", () => {
  it("throws NotFound for an unknown code", async () => {
    (prisma.shortUrl.findUnique as jest.Mock).mockResolvedValueOnce(null);
    await expect(getStats("missing", { limit: 20, offset: 0 })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("returns total clicks and recent events", async () => {
    (prisma.shortUrl.findUnique as jest.Mock).mockResolvedValueOnce(baseRecord);
    (prisma.clickEvent.count as jest.Mock).mockResolvedValueOnce(3);
    (prisma.clickEvent.findMany as jest.Mock).mockResolvedValueOnce([
      { occurredAt: new Date(), referrer: "https://ref.example", userAgent: "curl/8" },
    ]);

    const stats = await getStats("abc1234", { limit: 20, offset: 0 });

    expect(stats.totalClicks).toBe(3);
    expect(stats.recentEvents).toHaveLength(1);
  });
});

describe("softDeleteUrl", () => {
  it("throws NotFound for an unknown code", async () => {
    (prisma.shortUrl.findUnique as jest.Mock).mockResolvedValueOnce(null);
    await expect(softDeleteUrl("missing")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("marks the record inactive and invalidates the cache", async () => {
    (prisma.shortUrl.findUnique as jest.Mock).mockResolvedValueOnce(baseRecord);
    (prisma.shortUrl.update as jest.Mock).mockResolvedValueOnce({ ...baseRecord, isActive: false });
    (redis.del as jest.Mock).mockResolvedValueOnce(1);

    await softDeleteUrl("abc1234");

    expect(prisma.shortUrl.update).toHaveBeenCalledWith({ where: { code: "abc1234" }, data: { isActive: false } });
    expect(redis.del).toHaveBeenCalled();
  });
});
