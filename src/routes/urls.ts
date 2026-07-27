import { Router } from "express";
import { z } from "zod";
import { validateBody, validateQuery } from "../middleware/validate";
import { createUrlRateLimiter } from "../middleware/rateLimit";
import { createShortUrl, getStats, listUrls, softDeleteUrl } from "../services/urlService";

export const urlsRouter = Router();

const createUrlSchema = z.object({
  url: z.string().min(1),
  customAlias: z.string().optional(),
  expiresAt: z.string().optional(),
});

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const listQuerySchema = paginationSchema.extend({
  includeInactive: z.coerce.boolean().default(false),
});

urlsRouter.post("/", createUrlRateLimiter, validateBody(createUrlSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof createUrlSchema>;
    const dto = await createShortUrl({
      longUrl: body.url,
      customAlias: body.customAlias,
      expiresAt: body.expiresAt,
    });
    res.status(201).json(dto);
  } catch (err) {
    next(err);
  }
});

urlsRouter.get("/", validateQuery(listQuerySchema), async (req, res, next) => {
  try {
    const query = req.validatedQuery as z.infer<typeof listQuerySchema>;
    const result = await listUrls(query);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

urlsRouter.get("/:code/stats", validateQuery(paginationSchema), async (req, res, next) => {
  try {
    const query = req.validatedQuery as z.infer<typeof paginationSchema>;
    const stats = await getStats(req.params.code, query);
    res.status(200).json(stats);
  } catch (err) {
    next(err);
  }
});

urlsRouter.delete("/:code", async (req, res, next) => {
  try {
    await softDeleteUrl(req.params.code);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
