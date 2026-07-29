import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * Stateless, signed proof that a client already entered the correct password for a
 * specific protected link's code. Avoids needing a server-side session store: the
 * expiry is embedded in the token itself and verified via HMAC, not looked up.
 */
export function signUnlockToken(code: string): string {
  const expiresAt = Date.now() + env.LINK_UNLOCK_TTL_SECONDS * 1000;
  const signature = createHmac("sha256", env.LINK_UNLOCK_SECRET).update(`${code}.${expiresAt}`).digest("hex");
  return `${expiresAt}.${signature}`;
}

export function verifyUnlockToken(code: string, token: string | undefined): boolean {
  if (!token) return false;
  const [expiresAtRaw, signature] = token.split(".");
  if (!expiresAtRaw || !signature) return false;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;

  const expected = createHmac("sha256", env.LINK_UNLOCK_SECRET).update(`${code}.${expiresAt}`).digest("hex");
  const a = Buffer.from(signature, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function unlockCookieName(code: string): string {
  return `unlock_${code}`;
}
