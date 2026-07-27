import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { logger } from "../lib/logger";
import { env } from "../lib/env";
import { generateCode, CUSTOM_ALIAS_PATTERN } from "./codeGenerator";
import { isValidLongUrl } from "./urlValidator";
import { BadRequestError, ConflictError, GoneError, NotFoundError, ServiceUnavailableError } from "../errors";

const MAX_GENERATION_ATTEMPTS = 5;
const CACHE_TTL_SECONDS = 300;
const CACHE_KEY_PREFIX = "shortUrl:";

const PRISMA_UNIQUE_CONSTRAINT_ERROR = "P2002";

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === PRISMA_UNIQUE_CONSTRAINT_ERROR;
}

export interface CreateShortUrlInput {
  longUrl: string;
  customAlias?: string;
  expiresAt?: string;
}

export interface ShortUrlDTO {
  code: string;
  shortUrl: string;
  longUrl: string;
  createdAt: Date;
  expiresAt: Date | null;
  isActive: boolean;
}

interface CachedEntry {
  id: number;
  longUrl: string;
  isActive: boolean;
  expiresAt: string | null;
}

function toShortUrlDTO(record: {
  code: string;
  longUrl: string;
  createdAt: Date;
  expiresAt: Date | null;
  isActive: boolean;
}): ShortUrlDTO {
  return {
    code: record.code,
    shortUrl: `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/${record.code}`,
    longUrl: record.longUrl,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    isActive: record.isActive,
  };
}

function parseExpiresAt(expiresAt: string | undefined): Date | null {
  if (!expiresAt) return null;
  const parsed = new Date(expiresAt);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestError("expiresAt must be a valid ISO 8601 date-time string");
  }
  if (parsed.getTime() <= Date.now()) {
    throw new BadRequestError("expiresAt must be in the future");
  }
  return parsed;
}

async function cacheEntry(code: string, entry: CachedEntry, expiresAt: Date | null): Promise<void> {
  try {
    const ttl = expiresAt
      ? Math.max(1, Math.min(CACHE_TTL_SECONDS, Math.floor((expiresAt.getTime() - Date.now()) / 1000)))
      : CACHE_TTL_SECONDS;
    await redis.set(CACHE_KEY_PREFIX + code, JSON.stringify(entry), "EX", ttl);
  } catch (err) {
    // Cache is an accelerator, not a dependency: a Redis outage must not break create/redirect.
    logger.warn({ err, code }, "failed to write redirect cache entry");
  }
}

async function invalidateCache(code: string): Promise<void> {
  try {
    await redis.del(CACHE_KEY_PREFIX + code);
  } catch (err) {
    logger.warn({ err, code }, "failed to invalidate redirect cache entry");
  }
}

export async function createShortUrl(input: CreateShortUrlInput): Promise<ShortUrlDTO> {
  if (!isValidLongUrl(input.longUrl)) {
    throw new BadRequestError("url must be a valid http(s) URL of at most 2048 characters");
  }
  const expiresAt = parseExpiresAt(input.expiresAt);

  if (input.customAlias !== undefined) {
    if (!CUSTOM_ALIAS_PATTERN.test(input.customAlias)) {
      throw new BadRequestError("customAlias must be 3-32 characters of letters, digits, '_' or '-'");
    }
    try {
      const record = await prisma.shortUrl.create({
        data: { code: input.customAlias, longUrl: input.longUrl, expiresAt },
      });
      return toShortUrlDTO(record);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ConflictError(`alias '${input.customAlias}' is already in use`);
      }
      throw err;
    }
  }

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    const code = generateCode();
    try {
      const record = await prisma.shortUrl.create({
        data: { code, longUrl: input.longUrl, expiresAt },
      });
      return toShortUrlDTO(record);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        logger.warn({ code, attempt }, "short code collision, retrying");
        continue;
      }
      throw err;
    }
  }
  throw new ServiceUnavailableError("could not generate a unique short code, please retry");
}

export interface RedirectTarget {
  shortUrlId: number;
  longUrl: string;
}

export async function getRedirectTarget(code: string): Promise<RedirectTarget> {
  const cacheKey = CACHE_KEY_PREFIX + code;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const entry: CachedEntry = JSON.parse(cached);
      if (!entry.isActive) throw new GoneError(`short URL '${code}' has been deleted`);
      if (entry.expiresAt && new Date(entry.expiresAt).getTime() <= Date.now()) {
        throw new GoneError(`short URL '${code}' has expired`);
      }
      return { shortUrlId: entry.id, longUrl: entry.longUrl };
    }
  } catch (err) {
    if (err instanceof GoneError) throw err;
    logger.warn({ err, code }, "redirect cache read failed, falling back to database");
  }

  const record = await prisma.shortUrl.findUnique({ where: { code } });
  if (!record) {
    throw new NotFoundError(`short URL '${code}' not found`);
  }
  if (!record.isActive) {
    await cacheEntry(code, { id: record.id, longUrl: record.longUrl, isActive: false, expiresAt: null }, null);
    throw new GoneError(`short URL '${code}' has been deleted`);
  }
  if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
    await cacheEntry(
      code,
      { id: record.id, longUrl: record.longUrl, isActive: true, expiresAt: record.expiresAt.toISOString() },
      record.expiresAt,
    );
    throw new GoneError(`short URL '${code}' has expired`);
  }

  await cacheEntry(
    code,
    { id: record.id, longUrl: record.longUrl, isActive: true, expiresAt: record.expiresAt?.toISOString() ?? null },
    record.expiresAt,
  );
  return { shortUrlId: record.id, longUrl: record.longUrl };
}

export interface ClickMeta {
  referrer?: string;
  userAgent?: string;
  ip?: string;
}

export async function recordClick(shortUrlId: number, meta: ClickMeta): Promise<void> {
  try {
    await prisma.clickEvent.create({
      data: {
        shortUrlId,
        referrer: meta.referrer,
        userAgent: meta.userAgent,
        ipHash: meta.ip ? createHash("sha256").update(meta.ip).digest("hex").slice(0, 16) : undefined,
      },
    });
  } catch (err) {
    // Best-effort analytics: never let a click-logging failure surface to the client.
    logger.error({ err, shortUrlId }, "failed to record click event");
  }
}

export interface StatsQuery {
  limit: number;
  offset: number;
}

export async function getStats(code: string, query: StatsQuery) {
  const record = await prisma.shortUrl.findUnique({ where: { code } });
  if (!record) {
    throw new NotFoundError(`short URL '${code}' not found`);
  }
  const [totalClicks, recentEvents] = await Promise.all([
    prisma.clickEvent.count({ where: { shortUrlId: record.id } }),
    prisma.clickEvent.findMany({
      where: { shortUrlId: record.id },
      orderBy: { occurredAt: "desc" },
      take: query.limit,
      skip: query.offset,
    }),
  ]);

  return {
    ...toShortUrlDTO(record),
    totalClicks,
    recentEvents: recentEvents.map((e) => ({
      occurredAt: e.occurredAt,
      referrer: e.referrer,
      userAgent: e.userAgent,
    })),
    pagination: { limit: query.limit, offset: query.offset },
  };
}

export interface ListQuery {
  limit: number;
  offset: number;
  includeInactive: boolean;
}

export async function listUrls(query: ListQuery) {
  const where = query.includeInactive ? {} : { isActive: true };
  const [items, total] = await Promise.all([
    prisma.shortUrl.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: query.limit,
      skip: query.offset,
    }),
    prisma.shortUrl.count({ where }),
  ]);
  return {
    items: items.map(toShortUrlDTO),
    total,
    pagination: { limit: query.limit, offset: query.offset },
  };
}

export async function softDeleteUrl(code: string): Promise<void> {
  const record = await prisma.shortUrl.findUnique({ where: { code } });
  if (!record) {
    throw new NotFoundError(`short URL '${code}' not found`);
  }
  await prisma.shortUrl.update({ where: { code }, data: { isActive: false } });
  await invalidateCache(code);
}
