import { isCommunityMember, isUnassignedHoa, type Actor } from "./actor";

export async function contractorListAccess(
  actor: Actor, communityId?: string,
): Promise<"ok_all" | "ok_community" | "denied" | "not_member" | "community_required"> {
  if (actor.role !== "admin" && actor.role !== "property_manager") return "denied";
  if (communityId) {
    if (actor.role === "property_manager" && !await isCommunityMember(actor, communityId)) return "not_member";
    return "ok_community";
  }
  return actor.role === "admin" ? "ok_all" : "community_required";
}

export async function userListAccess(
  actor: Actor, communityId?: string,
): Promise<"all" | "community" | "community_required" | "not_member" | "other_community" | "not_authorized"> {
  if (isUnassignedHoa(actor)) return "other_community";
  if (actor.role === "admin") return "all";
  if (actor.role === "property_manager" || actor.role === "hoa_admin") {
    if (!communityId) return "community_required";
    if (actor.role === "property_manager") {
      if (!await isCommunityMember(actor, communityId)) return "not_member";
    } else if (actor.hoaCommunityId !== communityId) return "other_community";
    return "community";
  }
  return "not_authorized";
}

export function canManageUserStatus(actor: Actor): boolean {
  return actor.role === "admin" || actor.role === "property_manager" || actor.role === "hoa_admin";
}

export function canManagePortalUsers(actor: Actor): boolean {
  return actor.role === "property_manager" || actor.role === "hoa_admin";
}

export async function portalTargetAccess(
  actor: Actor, target: { role: string; hoaCommunityId: string | null },
  context: "portal" | "status" = "portal",
): Promise<"ok" | "no_community" | "not_in_community" | "hoa_member_only"> {
  if (isUnassignedHoa(actor)) return "not_in_community";
  if (actor.role === "property_manager") {
    // Status historically queries membership even for an unassigned target;
    // portal edit/removal reject that target before querying. Keep both orders.
    if (context === "portal" && !target.hoaCommunityId) return "no_community";
    const member = await isCommunityMember(actor, target.hoaCommunityId || "");
    if (!target.hoaCommunityId) return "no_community";
    if (!member) return "not_in_community";
  } else if (actor.role === "hoa_admin") {
    if (!target.hoaCommunityId || target.hoaCommunityId !== actor.hoaCommunityId) return "not_in_community";
    if (target.role !== "hoa_member") return "hoa_member_only";
  }
  // Other roles are rejected by each route's separate caller gate.
  return "ok";
}

export async function portalUserListAccess(
  actor: Actor, communityId: string,
): Promise<"ok" | "not_member" | "other_community" | "not_authorized"> {
  if (isUnassignedHoa(actor)) return "other_community";
  if (actor.role === "property_manager") {
    if (!await isCommunityMember(actor, communityId)) return "not_member";
  } else if (actor.role === "hoa_admin") {
    if (actor.hoaCommunityId !== communityId) return "other_community";
  } else return "not_authorized";
  return "ok";
}

export async function portalCreateAccess(
  actor: Actor, role: unknown, communityId: string,
): Promise<"ok" | "hoa_role_only" | "other_community" | "pm_role_only" | "not_member"> {
  if (isUnassignedHoa(actor)) return "other_community";
  if (actor.role === "hoa_admin") {
    if (role !== "hoa_member") return "hoa_role_only";
    if (communityId !== actor.hoaCommunityId) return "other_community";
  } else if (actor.role === "property_manager") {
    if (role !== "hoa_admin" && role !== "hoa_member") return "pm_role_only";
    if (!await isCommunityMember(actor, communityId)) return "not_member";
  }
  return "ok";
}

export function portalRoleAssignAccess(
  actor: Actor, role: unknown,
): "ok" | "hoa_role_only" | "pm_role_only" {
  if (isUnassignedHoa(actor)) return "hoa_role_only";
  if (actor.role === "hoa_admin" && role !== "hoa_member") return "hoa_role_only";
  if (actor.role === "property_manager" && role !== "hoa_admin" && role !== "hoa_member") return "pm_role_only";
  return "ok";
}
