import { isCommunityMember, type Actor } from "./actor";
import { canUseCommunityAssets } from "./assets";
import * as storage from "../storage";

type CommunityListPlan = { kind: "all" } | { kind: "hoa"; communityId: string } |
  { kind: "memberships_non_commercial" };

export function communityListPlan(actor: Actor): CommunityListPlan {
  if (actor.role === "admin" || actor.role === "map_creator") return { kind: "all" };
  if ((actor.role === "hoa_admin" || actor.role === "hoa_member") && actor.hoaCommunityId) {
    return { kind: "hoa", communityId: actor.hoaCommunityId };
  }
  return { kind: "memberships_non_commercial" };
}

export function joinsCreatedCommunity(actor: Actor): boolean {
  return actor.role === "map_creator";
}

export async function crewAccess(
  actor: Actor, communityId: string, queryCompanyId: unknown,
): Promise<{ companyId: string } | "denied" | "company_required"> {
  if (actor.role !== "admin" && actor.role !== "contractor_manager") return "denied";
  if (actor.role === "contractor_manager" &&
      (!actor.companyId || !await isCommunityMember(actor, communityId))) return "denied";
  const companyId = actor.role === "admin" ? queryCompanyId : actor.companyId;
  if (typeof companyId !== "string" || !companyId) return "company_required";
  return { companyId };
}

export function seesMemberUsernames(actor: Actor): boolean {
  return actor.role === "admin";
}

export function seesMemberCompanies(actor: Actor): boolean {
  return actor.role === "admin" || actor.role === "property_manager";
}

export function dashboardAccess(actor: Actor, communityId: string): Promise<boolean> {
  return canUseCommunityAssets(actor, communityId);
}

export async function roleDashboardCommunity(
  actor: Actor, queryCommunityId: string | undefined,
): Promise<{ communityId: string } | "hoa_unassigned" | "community_required" | "not_member"> {
  if (actor.role === "hoa_admin" || actor.role === "hoa_member") {
    if (!actor.hoaCommunityId) return "hoa_unassigned";
    return { communityId: actor.hoaCommunityId };
  }
  if (!queryCommunityId) return "community_required";
  if (actor.role !== "admin" && !await isCommunityMember(actor, queryCommunityId)) return "not_member";
  return { communityId: queryCommunityId };
}

export async function searchScope(
  actor: Actor, communityId?: string,
): Promise<{ kind: "one"; communityId: string } | { kind: "all" } |
  { kind: "memberships_non_commercial" } | "not_member"> {
  if (communityId) {
    if (actor.role !== "admin") {
      if (!await isCommunityMember(actor, communityId)) return "not_member";
      const community = await storage.getCommunityById(communityId);
      if (community?.organizationId) return "not_member";
    }
    return { kind: "one", communityId };
  }
  return actor.role === "admin" ? { kind: "all" } : { kind: "memberships_non_commercial" };
}

export function isAdminView(actor: Actor): boolean {
  return actor.role === "admin";
}
