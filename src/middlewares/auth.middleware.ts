import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../utils/jwt.js";
import { fail } from "../utils/response.js";

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return fail(res, 401, "Token autentikasi wajib dikirim.");
  }

  try {
    req.user = verifyAccessToken(token);
    return next();
  } catch {
    return fail(res, 401, "Token autentikasi tidak valid atau sudah kedaluwarsa.");
  }
}
