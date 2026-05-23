import rateLimit from "express-rate-limit";
import { fail } from "../utils/response.js";

export const globalRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => fail(res, 429, "Terlalu banyak permintaan."),
});

export const authRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => fail(res, 429, "Terlalu banyak percobaan autentikasi."),
});
