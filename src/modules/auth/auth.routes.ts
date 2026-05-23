import { Router } from "express";
import type { KstIdentifier, Role, User, UserRole } from "@prisma/client";
import { ApprovalStatus, UserStatus } from "@prisma/client";
import { z } from "zod";
import { env } from "../../config/env.js";
import { prisma } from "../../db/prisma.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { authRateLimit } from "../../middlewares/rateLimit.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { writeAudit } from "../../utils/audit.js";
import { createRefreshToken, hashToken, refreshTokenExpiresAt, signAccessToken } from "../../utils/jwt.js";
import { hashPassword, verifyPassword } from "../../utils/password.js";
import { toAuthUser, toPublicUser } from "../../utils/rbac.js";
import { AppError, ok } from "../../utils/response.js";
import { loginSchema, registerSchema, selectRoleSchema } from "./auth.schemas.js";

const router = Router();

const cookieOptions = {
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: env.COOKIE_SAME_SITE as "lax" | "strict" | "none",
  path: "/",
};

function roleKey(role: Pick<UserRole, "role" | "kstIdentifier">) {
  return `${role.role}:${role.kstIdentifier ?? "all"}`;
}

function roleMatches(role: Pick<UserRole, "role" | "kstIdentifier">, activeRole: Role, kst?: KstIdentifier) {
  if (role.role !== activeRole) return false;
  if (activeRole === "operator" && kst) return role.kstIdentifier === kst;
  return true;
}

async function issueSession(user: User, role: UserRole) {
  const authUser = toAuthUser(user, role);
  const { token: accessToken, expDate } = signAccessToken(authUser);
  const refreshToken = createRefreshToken();
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: refreshTokenExpiresAt(),
    },
  });
  return { accessToken, expDate, refreshToken, authUser };
}

router.post(
  "/register",
  authRateLimit,
  validate({ body: registerSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof registerSchema>;
    const passwordHash = await hashPassword(body.password);

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username: body.username,
          email: body.email,
          passwordHash,
          name: body.name,
          status: UserStatus.pending_approval,
        },
      });
      const registration = await tx.registrationRequest.create({
        data: {
          userId: user.id,
          requestedRole: body.requestedRole,
          requestedKstIdentifier: body.requestedKstIdentifier ?? null,
          status: ApprovalStatus.pending,
        },
      });
      return { user, registration };
    });

    return ok(
      res,
      {
        message: "Registrasi berhasil dikirim dan menunggu approval super admin.",
        userId: result.user.id,
        registrationRequestId: result.registration.id,
        status: result.user.status,
      },
      201,
    );
  }),
);

router.post(
  "/login",
  authRateLimit,
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof loginSchema>;
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ username: body.usernameOrEmail }, { email: body.usernameOrEmail.toLowerCase() }],
      },
      include: { roles: { where: { isActive: true } } },
    });

    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      throw new AppError(401, "Username/email atau password tidak sesuai.");
    }
    if (user.status !== UserStatus.active) {
      throw new AppError(403, "Akun belum aktif atau tidak dapat digunakan.");
    }

    const roles = user.roles;
    if (roles.length === 0) throw new AppError(403, "User belum memiliki role aktif.");

    if (!body.activeRole && roles.length > 1) {
      return ok(res, {
        accessToken: null,
        expDate: null,
        requiresRoleSelection: true,
        availableRoles: roles.map((role) => ({
          role: role.role,
          kstIdentifier: role.kstIdentifier,
          key: roleKey(role),
        })),
        user: null,
      });
    }

    const selectedRole =
      (body.activeRole
        ? roles.find((role) => roleMatches(role, body.activeRole!, body.kstIdentifier))
        : roles[0]) ?? null;

    if (!selectedRole) throw new AppError(403, "Role aktif yang dipilih tidak valid.");

    const session = await issueSession(user, selectedRole);
    res.cookie("refresh_token", session.refreshToken, {
      ...cookieOptions,
      expires: refreshTokenExpiresAt(),
    });
    await writeAudit(req, { action: "auth.login", entityType: "users", entityId: user.id });

    return ok(res, {
      accessToken: session.accessToken,
      expDate: session.expDate,
      requiresRoleSelection: false,
      availableRoles: [],
      user: toPublicUser(session.authUser),
    });
  }),
);

router.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const token = req.cookies?.refresh_token as string | undefined;
    if (!token) throw new AppError(401, "Refresh token tidak ditemukan.");

    const tokenHash = hashToken(token);
    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { include: { roles: { where: { isActive: true } } } } },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new AppError(401, "Refresh token tidak valid.");
    }
    if (stored.user.status !== UserStatus.active) {
      throw new AppError(403, "Akun tidak aktif.");
    }

    const role = stored.user.roles[0];
    if (!role) throw new AppError(403, "User belum memiliki role aktif.");

    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    const session = await issueSession(stored.user, role);
    res.cookie("refresh_token", session.refreshToken, {
      ...cookieOptions,
      expires: refreshTokenExpiresAt(),
    });

    return ok(res, {
      accessToken: session.accessToken,
      expDate: session.expDate,
      user: toPublicUser(session.authUser),
    });
  }),
);

router.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const token = req.cookies?.refresh_token as string | undefined;
    if (token) {
      await prisma.refreshToken.updateMany({
        where: { tokenHash: hashToken(token), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    res.clearCookie("refresh_token", cookieOptions);
    await writeAudit(req, { action: "auth.logout", entityType: "auth" }).catch(() => undefined);
    return ok(res, { message: "Logout berhasil." });
  }),
);

router.get("/me", authMiddleware, asyncHandler(async (req, res) => ok(res, { user: toPublicUser(req.user!) })));

router.post(
  "/select-role",
  authMiddleware,
  validate({ body: selectRoleSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof selectRoleSchema>;
    const user = await prisma.user.findUnique({
      where: { id: req.user!.sub },
      include: { roles: { where: { isActive: true } } },
    });
    if (!user || user.status !== UserStatus.active) throw new AppError(403, "Akun tidak aktif.");
    const selectedRole = user.roles.find((role) => roleMatches(role, body.activeRole, body.kstIdentifier));
    if (!selectedRole) throw new AppError(403, "Role aktif yang dipilih tidak valid.");
    const authUser = toAuthUser(user, selectedRole);
    const signed = signAccessToken(authUser);
    return ok(res, { accessToken: signed.token, expDate: signed.expDate, user: toPublicUser(authUser) });
  }),
);

export default router;
