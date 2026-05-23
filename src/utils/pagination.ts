import { z } from "zod";

export const paginationQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export function parsePagination(query: unknown) {
  const parsed = paginationQuerySchema.parse(query);
  const limit = parsed.limit ?? 10;
  const offset = parsed.offset ?? ((parsed.page ?? 1) - 1) * limit;
  return { offset, limit };
}
