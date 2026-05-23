import { Router } from "express";
import { Role, UserStatus } from "@prisma/client";
import { z } from "zod";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/requireRole.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { writeAudit } from "../../utils/audit.js";
import { hashPassword } from "../../utils/password.js";
import { parsePagination } from "../../utils/pagination.js";
import { ok } from "../../utils/response.js";
import { kstSchema, roleSchema } from "../auth/auth.schemas.js";
import { prisma } from "../../db/prisma.js";

const router = Router();

const listUsersQuery = z.object({
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  search: z.string().optional(),
  status: z.nativeEnum(UserStatus).optional(),
  role: z.nativeEnum(Role).optional(),
  kstIdentifier: kstSchema.optional(),
});

const createUserSchema = z
  .object({
    username: z.string().min(3).max(60),
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().min(2).max(120),
    pictureUri: z.string().url().nullable().optional(),
    roles: z
      .array(
        z.object({
          role: roleSchema,
          kstIdentifier: kstSchema.nullish(),
          isActive: z.boolean().optional(),
        }),
      )
      .min(1),
  })
  .superRefine((data, ctx) => {
    data.roles.forEach((role, index) => {
      if (role.role === "operator" && !role.kstIdentifier) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["roles", index, "kstIdentifier"],
          message: "Role operator wajib memiliki kstIdentifier.",
        });
      }
    });
  });

const patchUserSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  pictureUri: z.string().url().nullable().optional(),
  status: z.nativeEnum(UserStatus).optional(),
});

const rolesPatchSchema = z
  .object({
    roles: z.array(
      z.object({
        role: roleSchema,
        kstIdentifier: kstSchema.nullish(),
        isActive: z.boolean().optional(),
      }),
    ),
  })
  .superRefine((data, ctx) => {
    data.roles.forEach((role, index) => {
      if (role.role === "operator" && !role.kstIdentifier) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["roles", index, "kstIdentifier"],
          message: "Role operator wajib memiliki kstIdentifier.",
        });
      }
    });
  });

router.use(authMiddleware, requireRole("super_admin"));

router.get(
  "/",
  validate({ query: listUsersQuery }),
  asyncHandler(async (req, res) => {
    const { offset, limit } = parsePagination(req.query);
    const query = req.query as z.infer<typeof listUsersQuery>;
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" as const } },
              { email: { contains: query.search, mode: "insensitive" as const } },
              { username: { contains: query.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
      ...(query.role || query.kstIdentifier
        ? {
            roles: {
              some: {
                ...(query.role ? { role: query.role } : {}),
                ...(query.kstIdentifier ? { kstIdentifier: query.kstIdentifier } : {}),
              },
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        include: { roles: true },
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    return ok(res, {
      offset,
      limit,
      hasNext: offset + limit < total,
      total,
      items: items.map((user) => ({
        id: user.id,
        username: user.username,
        email: user.email,
        name: user.name,
        pictureUri: user.pictureUri,
        status: user.status,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        roles: user.roles.map((role) => ({
          id: role.id,
          role: role.role,
          kstIdentifier: role.kstIdentifier,
          isActive: role.isActive,
        })),
      })),
    });
  }),
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: String(req.params.id) },
      include: { roles: true },
    });
    return ok(res, user);
  }),
);

router.post(
  "/",
  validate({ body: createUserSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createUserSchema>;
    const passwordHash = await hashPassword(body.password);
    const user = await prisma.user.create({
      data: {
        username: body.username,
        email: body.email,
        passwordHash,
        name: body.name,
        pictureUri: body.pictureUri ?? null,
        status: UserStatus.active,
        roles: {
          create: body.roles.map((role) => ({
            role: role.role,
            kstIdentifier: role.role === "operator" ? role.kstIdentifier : null,
            isActive: role.isActive ?? true,
          })),
        },
      },
      include: { roles: true },
    });
    await writeAudit(req, { action: "users.create", entityType: "users", entityId: user.id });
    return ok(res, user, 201);
  }),
);

router.patch(
  "/:id",
  validate({ body: patchUserSchema }),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.update({
      where: { id: String(req.params.id) },
      data: req.body,
      include: { roles: true },
    });
    await writeAudit(req, { action: "users.update", entityType: "users", entityId: user.id });
    return ok(res, user);
  }),
);

router.patch(
  "/:id/roles",
  validate({ body: rolesPatchSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof rolesPatchSchema>;
    const user = await prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId: String(req.params.id) } });
      return tx.user.update({
        where: { id: String(req.params.id) },
        data: {
          roles: {
            create: body.roles.map((role) => ({
              role: role.role,
              kstIdentifier: role.role === "operator" ? role.kstIdentifier : null,
              isActive: role.isActive ?? true,
            })),
          },
        },
        include: { roles: true },
      });
    });
    await writeAudit(req, { action: "users.roles.update", entityType: "users", entityId: user.id });
    return ok(res, user);
  }),
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.update({
      where: { id: String(req.params.id) },
      data: { status: UserStatus.inactive },
    });
    await writeAudit(req, { action: "users.delete", entityType: "users", entityId: user.id });
    return ok(res, { message: "User dinonaktifkan.", deleted_id: user.id });
  }),
);

export default router;
