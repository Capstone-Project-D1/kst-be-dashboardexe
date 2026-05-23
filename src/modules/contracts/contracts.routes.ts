import { Router } from "express";
import { prisma } from "../../db/prisma.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { ok } from "../../utils/response.js";

const router = Router();

function allowedOperationsForRole(role: string, operations: string[]) {
  if (role === "super_admin") return operations;
  if (role === "manajemen") return operations.filter((operation) => operation === "read");
  return operations.filter((operation) => ["read", "write", "delete"].includes(operation));
}

function filterContractOperations(node: any, role: string): any {
  if (Array.isArray(node)) return node.map((item) => filterContractOperations(item, role));
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node.operations)) {
    return { ...node, operations: allowedOperationsForRole(role, node.operations) };
  }
  if (Array.isArray(node.items)) {
    return { ...node, items: node.items.map((item: any) => filterContractOperations(item, role)) };
  }
  return node;
}

router.get(
  "/",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const contracts = await prisma.dataContract.findMany({
      where:
        req.user!.activeRole === "operator"
          ? { kstIdentifier: { in: req.user!.kstAccess } }
          : undefined,
      orderBy: { kstIdentifier: "asc" },
    });

    return ok(
      res,
      contracts.map((contract) => {
        const json = contract.contractJson as any;
        return {
          kstIdentifier: contract.kstIdentifier,
          version: contract.version,
          contract: filterContractOperations(json.contract ?? [], req.user!.activeRole),
        };
      }),
    );
  }),
);

export default router;
