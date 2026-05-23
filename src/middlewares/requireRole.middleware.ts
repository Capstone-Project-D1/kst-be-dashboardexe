import type { NextFunction, Request, Response } from "express";
import type { KstIdentifier, Role } from "@prisma/client";
import type { Permission } from "../types/domain.js";
import { fail } from "../utils/response.js";

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return fail(res, 401, "Token autentikasi wajib dikirim.");
    if (!roles.includes(req.user.activeRole)) return fail(res, 403, "Akses ditolak.");
    return next();
  };
}

export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return fail(res, 401, "Token autentikasi wajib dikirim.");
    if (!req.user.permissions.includes(permission)) return fail(res, 403, "Akses ditolak.");
    return next();
  };
}

export function requireKstAccess(resolveKst: (req: Request) => KstIdentifier) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return fail(res, 401, "Token autentikasi wajib dikirim.");
    const kst = resolveKst(req);
    if (req.user.activeRole === "operator" && !req.user.kstAccess.includes(kst)) {
      return fail(res, 403, "Operator tidak memiliki akses ke KST ini.");
    }
    return next();
  };
}
