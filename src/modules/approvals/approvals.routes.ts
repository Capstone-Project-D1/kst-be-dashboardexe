import { Router } from "express";
import { ApprovalStatus, UserStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/requireRole.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { writeAudit } from "../../utils/audit.js";
import { parsePagination } from "../../utils/pagination.js";
import { AppError, ok } from "../../utils/response.js";
import { kstSchema } from "../auth/auth.schemas.js";
import { applyApprovedChange } from "../data/data.service.js";

const router = Router();

const approvalListQuery = z.object({
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  status: z.nativeEnum(ApprovalStatus).optional(),
  kstIdentifier: kstSchema.optional(),
  requestedBy: z.string().uuid().optional(),
});

const rejectSchema = z.object({ reason: z.string().min(1).max(500) });

router.use(authMiddleware);

router.get(
  "/registrations",
  requireRole("super_admin"),
  validate({ query: approvalListQuery.pick({ offset: true, limit: true, status: true }) }),
  asyncHandler(async (req, res) => {
    const { offset, limit } = parsePagination(req.query);
    const status = req.query.status as ApprovalStatus | undefined;
    const where = status ? { status } : {};
    const [items, total] = await Promise.all([
      prisma.registrationRequest.findMany({
        where,
        include: { user: true, reviewer: true },
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
      }),
      prisma.registrationRequest.count({ where }),
    ]);
    return ok(res, { offset, limit, hasNext: offset + limit < total, total, items });
  }),
);

router.post(
  "/registrations/:id/approve",
  requireRole("super_admin"),
  asyncHandler(async (req, res) => {
    const registration = await prisma.$transaction(async (tx) => {
      const request = await tx.registrationRequest.findUnique({ where: { id: String(req.params.id) } });
      if (!request) throw new AppError(404, "Permintaan registrasi tidak ditemukan.");
      if (request.status !== ApprovalStatus.pending) throw new AppError(409, "Permintaan sudah diproses.");
      await tx.user.update({ where: { id: request.userId }, data: { status: UserStatus.active } });
      await tx.userRole.create({
        data: {
          userId: request.userId,
          role: request.requestedRole,
          kstIdentifier: request.requestedRole === "operator" ? request.requestedKstIdentifier : null,
          isActive: true,
        },
      });
      return tx.registrationRequest.update({
        where: { id: request.id },
        data: {
          status: ApprovalStatus.approved,
          reviewedBy: req.user!.sub,
          reviewedAt: new Date(),
        },
        include: { user: true },
      });
    });
    await writeAudit(req, {
      action: "registration.approve",
      entityType: "registration_requests",
      entityId: registration.id,
    });
    return ok(res, registration);
  }),
);

router.post(
  "/registrations/:id/reject",
  requireRole("super_admin"),
  validate({ body: rejectSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof rejectSchema>;
    const registration = await prisma.$transaction(async (tx) => {
      const request = await tx.registrationRequest.findUnique({ where: { id: String(req.params.id) } });
      if (!request) throw new AppError(404, "Permintaan registrasi tidak ditemukan.");
      if (request.status !== ApprovalStatus.pending) throw new AppError(409, "Permintaan sudah diproses.");
      await tx.user.update({ where: { id: request.userId }, data: { status: UserStatus.rejected } });
      return tx.registrationRequest.update({
        where: { id: request.id },
        data: {
          status: ApprovalStatus.rejected,
          reason: body.reason,
          reviewedBy: req.user!.sub,
          reviewedAt: new Date(),
        },
      });
    });
    await writeAudit(req, {
      action: "registration.reject",
      entityType: "registration_requests",
      entityId: registration.id,
      metadata: { reason: body.reason },
    });
    return ok(res, registration);
  }),
);

router.get(
  "/data-changes",
  validate({ query: approvalListQuery }),
  asyncHandler(async (req, res) => {
    const { offset, limit } = parsePagination(req.query);
    const query = req.query as z.infer<typeof approvalListQuery>;
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.kstIdentifier ? { kstIdentifier: query.kstIdentifier } : {}),
      ...(query.requestedBy ? { requestedBy: query.requestedBy } : {}),
      ...(req.user!.activeRole === "operator" ? { requestedBy: req.user!.sub } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.dataChangeRequest.findMany({
        where,
        include: { requester: true, reviewer: true },
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
      }),
      prisma.dataChangeRequest.count({ where }),
    ]);
    return ok(res, { offset, limit, hasNext: offset + limit < total, total, items });
  }),
);

router.get(
  "/data-changes/:id",
  asyncHandler(async (req, res) => {
    const item = await prisma.dataChangeRequest.findUniqueOrThrow({
      where: { id: String(req.params.id) },
      include: { requester: true, reviewer: true },
    });
    if (req.user!.activeRole === "operator" && item.requestedBy !== req.user!.sub) {
      throw new AppError(403, "Operator hanya dapat melihat request miliknya.");
    }
    return ok(res, item);
  }),
);

router.post(
  "/data-changes/:id/approve",
  requireRole("super_admin"),
  asyncHandler(async (req, res) => {
    const change = await applyApprovedChange(req, String(req.params.id));
    return ok(res, change);
  }),
);

router.post(
  "/data-changes/:id/reject",
  requireRole("super_admin"),
  validate({ body: rejectSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof rejectSchema>;
    const change = await prisma.dataChangeRequest.update({
      where: { id: String(req.params.id), status: ApprovalStatus.pending },
      data: {
        status: ApprovalStatus.rejected,
        reason: body.reason,
        reviewedBy: req.user!.sub,
        reviewedAt: new Date(),
      },
    });
    await writeAudit(req, {
      action: "data.change_request.reject",
      entityType: "data_change_requests",
      entityId: change.id,
      metadata: { reason: body.reason },
    });
    return ok(res, change);
  }),
);

router.post(
  "/data-changes/:id/cancel",
  asyncHandler(async (req, res) => {
    const existing = await prisma.dataChangeRequest.findUnique({ where: { id: String(req.params.id) } });
    if (!existing) throw new AppError(404, "Request perubahan data tidak ditemukan.");
    if (existing.status !== ApprovalStatus.pending) throw new AppError(409, "Request sudah diproses.");
    if (req.user!.activeRole !== "super_admin" && existing.requestedBy !== req.user!.sub) {
      throw new AppError(403, "Tidak dapat membatalkan request milik user lain.");
    }
    const change = await prisma.dataChangeRequest.update({
      where: { id: String(req.params.id) },
      data: { status: ApprovalStatus.cancelled },
    });
    await writeAudit(req, {
      action: "data.change_request.cancel",
      entityType: "data_change_requests",
      entityId: change.id,
    });
    return ok(res, change);
  }),
);

export default router;
