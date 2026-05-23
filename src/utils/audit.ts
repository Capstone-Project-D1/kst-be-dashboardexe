import type { Request } from "express";
import { prisma } from "../db/prisma.js";

export function writeAudit(
  req: Request,
  input: { action: string; entityType: string; entityId?: string | null; metadata?: unknown },
) {
  return prisma.auditLog.create({
    data: {
      actorId: req.user?.sub ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      metadata: (input.metadata ?? {}) as object,
      ipAddress: req.ip,
      userAgent: req.header("user-agent") ?? null,
    },
  });
}
