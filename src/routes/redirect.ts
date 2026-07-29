import { Request, Router } from "express";
import { getRedirectTarget, recordClick, verifyLinkPassword } from "../services/urlService";
import { CUSTOM_ALIAS_PATTERN } from "../services/codeGenerator";
import { renderPasswordPromptPage } from "../views/passwordPrompt";
import { signUnlockToken, verifyUnlockToken, unlockCookieName } from "../lib/unlockToken";
import { unlockAttemptRateLimiter } from "../middleware/rateLimit";
import { env } from "../lib/env";

export const redirectRouter = Router();

// Constraining the param to the same charset short codes/aliases are drawn from
// keeps this catch-all route from swallowing unrelated paths (favicon.ico, etc.).
const CODE_PARAM = `:code(${CUSTOM_ALIAS_PATTERN.source.replace(/^\^|\$$/g, "")})`;

function isUnlocked(req: Request, code: string): boolean {
  const cookies = req.cookies as Record<string, string> | undefined;
  return verifyUnlockToken(code, cookies?.[unlockCookieName(code)]);
}

function clickMetaFrom(req: Request) {
  return {
    referrer: req.get("referer") ?? undefined,
    userAgent: req.get("user-agent") ?? undefined,
    ip: req.ip,
  };
}

redirectRouter.get<{ code: string }>(`/${CODE_PARAM}`, async (req, res, next) => {
  try {
    const { shortUrlId, longUrl, hasPassword } = await getRedirectTarget(req.params.code);

    if (hasPassword && !isUnlocked(req, req.params.code)) {
      res.status(200).type("html").send(renderPasswordPromptPage(req.params.code));
      return;
    }

    // Best-effort analytics: never let click logging delay or fail the redirect itself.
    void recordClick(shortUrlId, clickMetaFrom(req));

    res.redirect(302, longUrl);
  } catch (err) {
    next(err);
  }
});

redirectRouter.post<{ code: string }>(
  `/${CODE_PARAM}/unlock`,
  unlockAttemptRateLimiter,
  async (req, res, next) => {
    try {
      const { code } = req.params;
      const password = typeof (req.body as { password?: unknown })?.password === "string"
        ? (req.body as { password: string }).password
        : "";

      const passwordOk = await verifyLinkPassword(code, password);
      if (!passwordOk) {
        res.status(401).type("html").send(renderPasswordPromptPage(code, { error: true }));
        return;
      }

      // Re-resolve fresh rather than trusting state from before the password check --
      // also correctly surfaces 404/410 if the link changed in between.
      const { shortUrlId, longUrl } = await getRedirectTarget(code);

      res.cookie(unlockCookieName(code), signUnlockToken(code), {
        httpOnly: true,
        sameSite: "lax",
        secure: env.NODE_ENV === "production",
        maxAge: env.LINK_UNLOCK_TTL_SECONDS * 1000,
        path: `/${code}`,
      });

      void recordClick(shortUrlId, clickMetaFrom(req));

      res.redirect(302, longUrl);
    } catch (err) {
      next(err);
    }
  },
);
