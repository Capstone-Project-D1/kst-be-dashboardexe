import { Router } from "express";
import { z } from "zod";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/response.js";
import { kstSchema } from "../auth/auth.schemas.js";
import { readData, toPageContainer } from "../data/data.service.js";

const router = Router();

const reportQuerySchema = z.object({
  kst: kstSchema,
  report: z.string().min(1),
  year: z.string().optional(),
  month: z.string().optional(),
  format: z.enum(["csv", "xlsx", "pdf"]).default("csv"),
});

const reportPath: Record<string, string> = {
  "tracker-inovasi": "/tracker-inovasi",
  keberlanjutan: "/keberlanjutan/sensors",
  "stok-opname": "/stok-opname",
  "booklist-atp": "/booklist-atp/reservasi",
  pertanian: "/pertanian",
  peternakan: "/peternakan",
  konservasi: "/konservasi",
  "pelayanan-akademik": "/pelayanan-akademik",
  kemitraan: "/kemitraan",
};

function toCsv(items: any[]) {
  if (items.length === 0) return "No data\n";
  const keys = Object.keys(items[0]).filter((key) => !["id", "year", "month", "view"].includes(key));
  const lines = [keys.join(",")];
  for (const item of items) {
    lines.push(keys.map((key) => `"${String(item[key] ?? "").replaceAll('"', '""')}"`).join(","));
  }
  return lines.join("\n");
}

router.get(
  "/download",
  authMiddleware,
  validate({ query: reportQuerySchema }),
  asyncHandler(async (req, res) => {
    res.setHeader("X-KST-Data-Source", "local-prisma");
    const query = req.query as z.infer<typeof reportQuerySchema>;
    if (!req.user!.permissions.includes("download_report")) throw new AppError(403, "Akses ditolak.");
    if (req.user!.activeRole === "operator" && !req.user!.kstAccess.includes(query.kst)) {
      throw new AppError(403, "Operator tidak dapat mengunduh laporan KST lain.");
    }
    if (query.format !== "csv") {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="laporan-${query.report}.${query.format}"`);
      return res.send(`Format ${query.format.toUpperCase()} belum tersedia. Gunakan CSV untuk sementara.\n`);
    }

    const path = reportPath[query.report.toLowerCase().replaceAll(" ", "-")];
    if (!path) throw new AppError(404, "Jenis laporan tidak ditemukan.");
    const data = await readData(path, req.user!, query as any, query.kst);
    const page = toPageContainer(data);
    const csv = toCsv(page.items ?? []);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="laporan-${query.kst}-${query.report}-${query.year ?? "all"}-${query.month ?? "all"}.csv"`,
    );
    return res.send(csv);
  }),
);

export default router;
