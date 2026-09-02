import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Request } from "express";
import { resolvePortfolioOrg } from "./portfolioOrgResolver.js";

function request(input: {
  role: "admin" | "client_admin";
  userOrgId?: string | null;
  sessionOrgId?: string;
  queryOrgId?: string;
}): Request {
  return {
    currentUser: { role: input.role, organizationId: input.userOrgId },
    query: input.queryOrgId ? { organizationId: input.queryOrgId } : {},
    session: { organizationId: input.sessionOrgId },
  } as unknown as Request;
}

describe("resolvePortfolioOrg", () => {
  it("requires admins to select an organization", () => {
    assert.deepEqual(resolvePortfolioOrg(request({ role: "admin" })), {
      orgId: null,
      status: 400,
      error: "organizationId query param is required for admin",
    });
    assert.deepEqual(resolvePortfolioOrg(request({ role: "admin", queryOrgId: "org-a" })), {
      orgId: "org-a",
    });
  });

  it("does not let client admins select another organization by query parameter", () => {
    assert.deepEqual(resolvePortfolioOrg(request({
      role: "client_admin",
      userOrgId: "org-b",
      queryOrgId: "org-a",
    })), { orgId: "org-b" });
  });

  it("uses the freshly loaded user organization ahead of stale session data", () => {
    assert.deepEqual(resolvePortfolioOrg(request({
      role: "client_admin",
      userOrgId: "org-new",
      sessionOrgId: "org-old",
    })), { orgId: "org-new" });
  });
});