import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export interface MeUser {
  id: string;
  role: string;
  displayName: string | null;
  username: string;
  companyName?: string | null;
  hoaCommunityId?: string | null;
}
export interface CommunityRef { id: string; name: string }
export interface Me {
  user: MeUser;
  communities: CommunityRef[];
  defaultCommunityId: string | null;
}

export const ME_KEY = ["me"] as const;

export function useMe() {
  return useQuery({ queryKey: ME_KEY, queryFn: ({ signal }) => api<Me>("/api/auth/me", { signal }) });
}

export const WEB_BASE: Record<string, string> = {
  admin: "/web/admin",
  property_manager: "/web/pm",
  hoa_admin: "/web/hoa",
  hoa_member: "/web/hoa",
  contractor_manager: "/web/contractor",
  contractor: "/web/contractor",
};

/** Mirrors roleDashboard in src/server.ts. */
export const ROLE_DASHBOARD: Record<string, string> = {
  admin: "/web/admin/dashboard",
  property_manager: "/web/pm/dashboard",
  contractor: "/web/contractor/dashboard",
  contractor_manager: "/web/contractor/dashboard",
  hoa_admin: "/web/hoa/dashboard",
  hoa_member: "/web/hoa/dashboard",
  client_admin: "/web/portfolio/dashboard",
  map_creator: "/web/login",
};

export function webBase(role: string): string {
  return WEB_BASE[role] ?? "/web";
}
export const isStaff = (role: string) => role === "admin";
export const isHoa = (role: string) => role === "hoa_admin" || role === "hoa_member";

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
