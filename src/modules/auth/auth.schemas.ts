import { z } from "zod";

export const roleSchema = z.enum(["super_admin", "manajemen", "operator"]);
export const kstSchema = z.enum(["ngijo", "cangar", "jatikerto"]);

export const registerSchema = z
  .object({
    username: z.string().min(3).max(60),
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().min(2).max(120),
    requestedRole: z.enum(["manajemen", "operator"]),
    requestedKstIdentifier: kstSchema.nullish(),
  })
  .superRefine((data, ctx) => {
    if (data.requestedRole === "operator" && !data.requestedKstIdentifier) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requestedKstIdentifier"],
        message: "Operator wajib memilih satu KST.",
      });
    }
  });

export const loginSchema = z.object({
  usernameOrEmail: z.string().min(1),
  password: z.string().min(1),
  activeRole: roleSchema.optional(),
  kstIdentifier: kstSchema.optional(),
});

export const selectRoleSchema = z.object({
  activeRole: roleSchema,
  kstIdentifier: kstSchema.optional(),
});
