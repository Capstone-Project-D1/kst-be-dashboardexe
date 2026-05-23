import type { ErrorRequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { AppError, fail } from "../utils/response.js";

export const errorMiddleware: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof AppError) {
    return fail(res, error.code, error.message);
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return fail(res, 409, "Data dengan nilai unik tersebut sudah terdaftar.");
  }

  logger.error({ error, path: req.path }, "Unhandled request error");
  const message =
    env.NODE_ENV === "production" ? "Terjadi kesalahan pada server." : String(error.message);
  return fail(res, 500, message);
};
