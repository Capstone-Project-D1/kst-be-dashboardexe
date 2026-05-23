import crypto from "node:crypto";
import type { DataChangeMethod, DataEntry, KstIdentifier, Prisma } from "@prisma/client";
import { ApprovalStatus } from "@prisma/client";
import type { Request } from "express";
import { prisma } from "../../db/prisma.js";
import type { AuthUser } from "../../types/domain.js";
import { writeAudit } from "../../utils/audit.js";
import { parsePagination } from "../../utils/pagination.js";
import { canAccessKst } from "../../utils/rbac.js";
import { AppError } from "../../utils/response.js";

type JsonObject = Record<string, any>;

export function normalizePath(path: string) {
  const clean = path.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return `/${clean}`;
}

export function inferKstFromPath(path: string): KstIdentifier | null {
  if (path.startsWith("/ngijo/") || path.includes("tracker-inovasi") || path.includes("keberlanjutan")) {
    return "ngijo";
  }
  if (path.startsWith("/cangar/") || path.includes("stok-opname") || path.includes("booklist-atp")) {
    return "cangar";
  }
  if (path.startsWith("/jatikerto/")) return "jatikerto";
  if (["/pertanian", "/peternakan", "/konservasi", "/pelayanan-akademik", "/kemitraan"].some((p) => path.startsWith(p))) {
    return "jatikerto";
  }
  return null;
}

export async function getEntryOrThrow(path: string, user: AuthUser, kstOverride?: KstIdentifier) {
  const normalized = normalizePath(path);
  const kstIdentifier = kstOverride ?? inferKstFromPath(normalized);
  if (!kstIdentifier) throw new AppError(404, "Path data tidak dikenal.");
  if (!canAccessKst(user, kstIdentifier)) throw new AppError(403, "Tidak memiliki akses ke KST ini.");

  const entry = await prisma.dataEntry.findUnique({
    where: { kstIdentifier_path: { kstIdentifier, path: normalized } },
  });
  if (!entry) throw new AppError(404, "Data tidak ditemukan.");
  return entry;
}

function filterItems(items: JsonObject[], query: Record<string, any>) {
  let result = [...items];
  const year = query.year ? String(query.year) : undefined;
  const month = query.month ? String(query.month) : undefined;
  const search = query.search ? String(query.search).toLowerCase() : undefined;
  const searchCol = query.search_col ? String(query.search_col) : undefined;
  const view = query.view ? String(query.view) : undefined;

  if (year) result = result.filter((item) => !item.year || String(item.year) === year);
  if (month && month !== "Semua Bulan") {
    result = result.filter((item) => !item.month || String(item.month) === month);
  }
  if (view) result = result.filter((item) => !item.view || String(item.view) === view);
  if (search) {
    result = result.filter((item) => {
      if (searchCol) return String(item[searchCol] ?? "").toLowerCase().includes(search);
      return Object.values(item).some((value) => String(value ?? "").toLowerCase().includes(search));
    });
  }

  const sortCol = query.sort_col ? String(query.sort_col) : undefined;
  const sortOrder = String(query.sort_order ?? "asc").toLowerCase();
  if (sortCol) {
    result.sort((a, b) => {
      const left = a[sortCol];
      const right = b[sortCol];
      if (left === right) return 0;
      const compared = left > right ? 1 : -1;
      return sortOrder === "desc" ? compared * -1 : compared;
    });
  }

  return result;
}

export function materializeData(entry: DataEntry, query: Record<string, any>) {
  const data = entry.data as JsonObject;
  if (data.typeName !== "table") return data;

  const { offset, limit } = parsePagination(query);
  const filtered = filterItems(Array.isArray(data.items) ? data.items : [], query);
  const items = filtered.slice(offset, offset + limit);
  return {
    ...data,
    offset,
    limit,
    hasNext: offset + limit < filtered.length,
    total: filtered.length,
    items,
  };
}

export async function readData(path: string, user: AuthUser, query: Record<string, any>, kst?: KstIdentifier) {
  const entry = await getEntryOrThrow(path, user, kst);
  return {
    code: entry.code,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt?.toISOString() ?? null,
    data: materializeData(entry, query),
  };
}

function ensureWriteAllowed(user: AuthUser, kst: KstIdentifier) {
  if (!canAccessKst(user, kst)) throw new AppError(403, "Tidak memiliki akses ke KST ini.");
  if (user.activeRole === "manajemen") throw new AppError(403, "Role manajemen hanya boleh melihat data.");
}

function applyMutationToData(data: JsonObject, method: DataChangeMethod, body: JsonObject, rowId?: string) {
  if (data.typeName !== "table") {
    if (method === "delete") return { ...data, value: null };
    return { ...data, ...body };
  }

  const items = Array.isArray(data.items) ? [...data.items] : [];
  if (method === "create") {
    const next = { id: crypto.randomUUID(), no: items.length + 1, ...body };
    return { ...data, items: [...items, next], lastInsertedId: next.id };
  }

  const targetId = rowId ?? body.id ?? body.rowId;
  if (!targetId) throw new AppError(400, "ID baris wajib dikirim untuk update/delete.");
  const index = items.findIndex((item) => String(item.id ?? item.no ?? item.rowId) === String(targetId));
  if (index < 0) throw new AppError(404, "Baris data tidak ditemukan.");

  if (method === "delete") {
    items.splice(index, 1);
    return { ...data, items };
  }

  items[index] = { ...items[index], ...body, id: items[index].id ?? targetId };
  return { ...data, items };
}

export async function mutateData(
  req: Request,
  input: {
    path: string;
    kstIdentifier: KstIdentifier;
    method: DataChangeMethod;
    body: JsonObject;
    rowId?: string;
  },
) {
  const user = req.user!;
  ensureWriteAllowed(user, input.kstIdentifier);
  const entry = await getEntryOrThrow(input.path, user, input.kstIdentifier);

  if (user.activeRole === "operator") {
    const change = await prisma.dataChangeRequest.create({
      data: {
        requestedBy: user.sub,
        kstIdentifier: input.kstIdentifier,
        dataEntryId: entry.id,
        path: normalizePath(input.path),
        method: input.method,
        oldValue: entry.data as Prisma.InputJsonValue,
        newValue: { body: input.body, rowId: input.rowId } as Prisma.InputJsonValue,
        status: ApprovalStatus.pending,
      },
    });
    await writeAudit(req, {
      action: "data.change_request.create",
      entityType: "data_change_requests",
      entityId: change.id,
      metadata: { path: input.path, method: input.method },
    });
    return {
      message: "Perubahan berhasil diajukan dan menunggu verifikasi DIKST.",
      changeRequestId: change.id,
      status: change.status,
    };
  }

  const nextData = applyMutationToData(entry.data as JsonObject, input.method, input.body, input.rowId);
  await prisma.dataEntry.update({
    where: { id: entry.id },
    data: { data: nextData as Prisma.InputJsonValue },
  });
  await writeAudit(req, {
    action: `data.${input.method}`,
    entityType: "data_entries",
    entityId: entry.id,
    metadata: { path: input.path },
  });
  return { message: "Data berhasil dimodifikasi." };
}

export function toPageContainer(dataContainer: { data: any }) {
  const data = dataContainer.data;
  if (data?.typeName === "table") {
    return {
      offset: data.offset ?? 0,
      limit: data.limit ?? 10,
      hasNext: Boolean(data.hasNext),
      total: data.total ?? data.items?.length ?? 0,
      items: data.items ?? [],
      operations: data.operations,
    };
  }
  return data;
}

export async function applyApprovedChange(req: Request, changeId: string) {
  return prisma.$transaction(async (tx) => {
    const change = await tx.dataChangeRequest.findUnique({
      where: { id: changeId },
      include: { dataEntry: true },
    });
    if (!change) throw new AppError(404, "Approval perubahan data tidak ditemukan.");
    if (change.status !== ApprovalStatus.pending) throw new AppError(409, "Approval sudah diproses.");
    if (!change.dataEntry) throw new AppError(404, "Data entry target tidak ditemukan.");

    const payload = change.newValue as JsonObject;
    const nextData = applyMutationToData(
      change.dataEntry.data as JsonObject,
      change.method,
      payload.body ?? {},
      payload.rowId,
    );

    await tx.dataEntry.update({
      where: { id: change.dataEntry.id },
      data: { data: nextData as Prisma.InputJsonValue },
    });
    const updated = await tx.dataChangeRequest.update({
      where: { id: change.id },
      data: {
        status: ApprovalStatus.approved,
        reviewedBy: req.user!.sub,
        reviewedAt: new Date(),
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: req.user!.sub,
        action: "data.change_request.approve",
        entityType: "data_change_requests",
        entityId: change.id,
        metadata: { path: change.path },
        ipAddress: req.ip,
        userAgent: req.header("user-agent") ?? null,
      },
    });
    return updated;
  });
}
