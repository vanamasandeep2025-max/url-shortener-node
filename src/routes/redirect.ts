import { Router } from "express";
import { getRedirectTarget, recordClick } from "../services/urlService";
import { CUSTOM_ALIAS_PATTERN } from "../services/codeGenerator";

export const redirectRouter = Router();

// Constraining the param to the same charset short codes/aliases are drawn from
// keeps this catch-all route from swallowing unrelated paths (favicon.ico, etc.).
const CODE_PARAM = `:code(${CUSTOM_ALIAS_PATTERN.source.replace(/^\^|\$$/g, "")})`;

redirectRouter.get<{ code: string }>(`/${CODE_PARAM}`, async (req, res, next) => {
  try {
    const { shortUrlId, longUrl } = await getRedirectTarget(req.params.code);

    // Best-effort analytics: never let click logging delay or fail the redirect itself.
    void recordClick(shortUrlId, {
      referrer: req.get("referer") ?? undefined,
      userAgent: req.get("user-agent") ?? undefined,
      ip: req.ip,
    });

    res.redirect(302, longUrl);
  } catch (err) {
    next(err);
  }
});
