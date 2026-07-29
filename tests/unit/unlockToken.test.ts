import { createHmac } from "node:crypto";
import { env } from "../../src/lib/env";
import { signUnlockToken, verifyUnlockToken, unlockCookieName } from "../../src/lib/unlockToken";

describe("unlockToken", () => {
  it("verifies a token it just signed for the same code", () => {
    const token = signUnlockToken("abc1234");
    expect(verifyUnlockToken("abc1234", token)).toBe(true);
  });

  it("rejects a token signed for a different code", () => {
    const token = signUnlockToken("abc1234");
    expect(verifyUnlockToken("other-code", token)).toBe(false);
  });

  it("rejects an expired token", () => {
    // Construct a token as if it were signed in the past, bypassing signUnlockToken's
    // "now + ttl" so we don't have to fake system time.
    const pastExpiry = Date.now() - 1000;
    const signature = createHmac("sha256", env.LINK_UNLOCK_SECRET)
      .update(`abc1234.${pastExpiry}`)
      .digest("hex");
    const expiredToken = `${pastExpiry}.${signature}`;

    expect(verifyUnlockToken("abc1234", expiredToken)).toBe(false);
  });

  it("rejects missing, empty, or malformed tokens", () => {
    expect(verifyUnlockToken("abc1234", undefined)).toBe(false);
    expect(verifyUnlockToken("abc1234", "")).toBe(false);
    expect(verifyUnlockToken("abc1234", "not-a-valid-token")).toBe(false);
    expect(verifyUnlockToken("abc1234", "12345")).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const token = signUnlockToken("abc1234");
    const [expiresAt] = token.split(".");
    expect(verifyUnlockToken("abc1234", `${expiresAt}.0000000000000000000000000000000000000000000000000000000000000000`)).toBe(
      false,
    );
  });

  it("builds a per-code cookie name", () => {
    expect(unlockCookieName("abc1234")).toBe("unlock_abc1234");
    expect(unlockCookieName("other")).toBe("unlock_other");
  });
});
