import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { corsOptions } from "./config/cors.js";
import { logger } from "./config/logger.js";
import { errorMiddleware, notFoundMiddleware } from "./middlewares/error.middleware.js";
import { globalRateLimit } from "./middlewares/rateLimit.middleware.js";
import approvalsRoutes from "./modules/approvals/approvals.routes.js";
import authRoutes from "./modules/auth/auth.routes.js";
import cangarCompatRoutes from "./modules/cangar/cangar.compat.routes.js";
import cangarRoutes from "./modules/cangar/cangar.routes.js";
import contractsRoutes from "./modules/contracts/contracts.routes.js";
import dashboardRoutes from "./modules/dashboard/dashboard.routes.js";
import dataRoutes from "./modules/data/data.routes.js";
import gatewayRoutes, { kstGatewayRoutes } from "./modules/gateway/gateway.routes.js";
import healthRoutes from "./modules/health/health.routes.js";
import jatikertoRoutes from "./modules/jatikerto/jatikerto.routes.js";
import reportsRoutes from "./modules/reports/reports.routes.js";
import usersRoutes from "./modules/users/users.routes.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors(corsOptions));
  app.options("*", cors(corsOptions));
  app.use(cookieParser());
  app.use(express.json({ limit: "3mb" }));
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));
  app.use(globalRateLimit);
  app.use((pinoHttp as any)({ logger }));

  app.use("/health", healthRoutes);
  app.use("/api/kst/cangar", cangarRoutes);
  app.use("/api/gateway/cangar", cangarRoutes);
  app.use("/api/gateway/jatikerto", jatikertoRoutes);
  app.use("/api", gatewayRoutes);
  app.use("/kst/cangar", cangarCompatRoutes);
  app.use("/kst/cangar", cangarRoutes);
  app.use("/kst/jatikerto", jatikertoRoutes);
  app.use(kstGatewayRoutes);
  app.use("/auth", authRoutes);
  app.use("/users", usersRoutes);
  app.use("/approvals", approvalsRoutes);
  app.use("/contract", contractsRoutes);
  app.use("/dashboard", dashboardRoutes);
  app.use("/reports", reportsRoutes);
  app.use(dataRoutes);

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}

export const app = createApp();
