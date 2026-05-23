import type { Role, KstIdentifier, UserStatus } from "@prisma/client";

export type Permission =
  | "read"
  | "write"
  | "delete"
  | "approve"
  | "manage_users"
  | "submit_edit"
  | "download_report";

export interface AuthUser {
  sub: string;
  username: string;
  email: string;
  name: string;
  activeRole: Role;
  kstAccess: KstIdentifier[];
  permissions: Permission[];
  pictureUri?: string | null;
}

export interface PublicUser {
  userid: string;
  username: string;
  email: string;
  name: string;
  activeRole: Role;
  kstAccess: KstIdentifier[];
  permissions: Permission[];
  pictureUri: string | null;
  status?: UserStatus;
}

export interface PageQuery {
  offset: number;
  limit: number;
}
