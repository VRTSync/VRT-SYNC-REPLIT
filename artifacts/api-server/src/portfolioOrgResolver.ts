import type { Request } from "express";

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

  // currentUser was loaded fresh from the DB by requireClientOrAdmin. The
  // session value only supports older sessions that predate that middleware.
  const orgId = user?.organizationId ?? req.session.organizationId;
  if (!orgId) return { orgId: null, status: 403, error: "No organization assigned to this account" };
  return { orgId };
}