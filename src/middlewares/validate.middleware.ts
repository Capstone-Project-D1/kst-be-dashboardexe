import type { NextFunction, Request, Response } from "express";
import type { AnyZodObject, ZodEffects } from "zod";
import { ZodError } from "zod";
import { fail } from "../utils/response.js";

type Schema = AnyZodObject | ZodEffects<AnyZodObject>;

export function validate(schema: { body?: Schema; query?: Schema; params?: Schema }) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      if (schema.body) req.body = schema.body.parse(req.body);
      if (schema.query) req.query = schema.query.parse(req.query) as any;
      if (schema.params) req.params = schema.params.parse(req.params) as any;
      return next();
    } catch (error) {
      if (error instanceof ZodError) {
        return fail(res, 422, error.issues.map((issue) => issue.message).join("; "));
      }
      return fail(res, 400, "Request tidak valid.");
    }
  };
}
