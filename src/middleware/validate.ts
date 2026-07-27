import { NextFunction, Request, Response } from "express";
import { ZodSchema } from "zod";
import { BadRequestError } from "../errors";

export function validateBody(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(new BadRequestError("request body failed validation", result.error.flatten().fieldErrors));
      return;
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      next(new BadRequestError("query parameters failed validation", result.error.flatten().fieldErrors));
      return;
    }
    // req.query is a getter-only property on some Express/Node versions; assign via defineProperty-safe route locals instead.
    req.validatedQuery = result.data;
    next();
  };
}
