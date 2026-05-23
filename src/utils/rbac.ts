import type { KstIdentifier, Role, User, UserRole } from "@prisma/client";
import type { AuthUser, Permission, PublicUser } from "../types/domain.js";

const ALL_KST: KstIdentifier[] = ["ngijo", "cangar", "jatikerto"];

export function permissionsForRole(role: Role): Permission[] {
  if (role === "super_admin") {
    return ["read", "write", "delete", "approve", "manage_users", "download_report"];
  }
  if (role === "manajemen") return ["read", "download_report"];
  return ["read", "submit_edit", "download_report"];
}

export function kstAccessForRole(role: Role, kstIdentifier?: KstIdentifier | null): KstIdentifier[] {
  if (role === "super_admin" || role === "manajemen") return ALL_KST;
  return kstIdentifier ? [kstIdentifier] : [];
}

export function toAuthUser(
  user: Pick<User, "id" | "username" | "email" | "name" | "pictureUri">,
  role: Pick<UserRole, "role" | "kstIdentifier">,
): AuthUser {
  return {
    sub: user.id,
    username: user.username,
    email: user.email,
    name: user.name,
    activeRole: role.role,
    kstAccess: kstAccessForRole(role.role, role.kstIdentifier),
    permissions: permissionsForRole(role.role),
    pictureUri: user.pictureUri,
  };
}

export function toPublicUser(authUser: AuthUser): PublicUser {
  return {
    userid: authUser.sub,
    username: authUser.username,
    email: authUser.email,
    name: authUser.name,
    activeRole: authUser.activeRole,
    kstAccess: authUser.kstAccess,
    permissions: authUser.permissions,
    pictureUri: authUser.pictureUri ?? null,
  };
}

export function canAccessKst(user: AuthUser, kst: KstIdentifier) {
  return user.activeRole !== "operator" || user.kstAccess.includes(kst);
}
