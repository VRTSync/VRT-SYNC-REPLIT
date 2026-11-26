import type { Request } from "express";
import * as storage from "../storage";

export type PortfolioOrgResolution =
  | { orgId: string }
  | { orgId: null; status: number; error: string };

/**
 * Admins select an organization explicitly. Client roles are always pinned to
 * their current database-backed organization, regardless of query parameters.
 */
export function resolvePortfolioOrg(req: Request): PortfolioOrgResolution {
  const user = (req as any).currentUser;
  if (user?.role === "admin") {
    const orgId = req.query.organizationId as string | undefined;
    if (!orgId) return { orgId: null, status: 400, error: "organizationId query param is required for admin" };
    return { orgId };
  }

  const orgId = user?.organizationId;
  if (!orgId) return { orgId: null, status: 403, error: "No organization assigned to this account" };
  return { orgId };
}

export function orgOwnsCommunity<T extends { organizationId: string | null }>(
  orgId: string, community: T | null | undefined,
): community is T {
  return !!community && community.organizationId === orgId;
}

/** The /me endpoint keeps its own historical missing-organization response. */
export function clientPortfolioOrg(req: Request): string | null {
  return req.currentUser?.organizationId ?? null;
}

export async function orgOwnsGroup(orgId: string, groupId: string): Promise<boolean> {
  return (await storage.listBranchGroups(orgId)).some(group => group.id === groupId);
}

export async function orgOwnsGroupSet(orgId: string, setId: string): Promise<boolean> {
  return (await storage.getGroupSets(orgId)).some(set => set.id === setId);
}

export async function orgOwnsCommunities(orgId: string, communityIds: string[]): Promise<boolean> {
  if (communityIds.length === 0) return true;
  const orgCommunityIds = new Set(await storage.getCommunityIdsForOrganization(orgId));
  return communityIds.every(id => orgCommunityIds.has(id));
}
