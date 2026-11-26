import type { Actor } from "./actor";
import { isCommunityMember, isUnassignedHoa } from "./actor";

type ContactListPlan = { kind: "all"; communityId?: string } |
  { kind: "community"; communityId: string } | { kind: "my_communities" } | "not_member" | "denied";

export async function contactListPlan(actor: Actor, communityId?: string): Promise<ContactListPlan> {
  if (isUnassignedHoa(actor)) return "denied";
  if (actor.role === "admin") return { kind: "all", communityId: communityId || undefined };
  if (actor.role === "property_manager") {
    if (!communityId) return { kind: "my_communities" };
    if (!await isCommunityMember(actor, communityId)) return "not_member";
    return { kind: "community", communityId };
  }
  if ((actor.role === "hoa_admin" || actor.role === "hoa_member") && actor.hoaCommunityId) {
    return { kind: "community", communityId: actor.hoaCommunityId };
  }
  return "denied";
}

export function canWriteContacts(actor: Actor): boolean {
  return actor.role === "admin" || actor.role === "property_manager" || actor.role === "hoa_admin";
}

export async function contactCreateAccess(actor: Actor, communityId: string): Promise<"ok" | "not_member" | "other_community"> {
  if (isUnassignedHoa(actor)) return "other_community";
  if (actor.role === "property_manager" && !await isCommunityMember(actor, communityId)) return "not_member";
  if ((actor.role === "hoa_admin" || actor.role === "hoa_member") &&
      actor.hoaCommunityId && communityId !== actor.hoaCommunityId) return "other_community";
  return "ok";
}

export async function contactChangeAccess(actor: Actor, contact: { communityId: string }): Promise<"ok" | "not_member" | "denied"> {
  if (isUnassignedHoa(actor)) return "denied";
  if (actor.role === "property_manager" && !await isCommunityMember(actor, contact.communityId)) return "not_member";
  if (actor.role === "hoa_admin" && actor.hoaCommunityId && contact.communityId !== actor.hoaCommunityId) return "denied";
  return "ok";
}

export async function contactMoveAccess(actor: Actor, targetCommunityId: string): Promise<"ok" | "hoa_cannot_move" | "not_member_target"> {
  if (actor.role === "hoa_admin") return "hoa_cannot_move";
  if (actor.role === "property_manager" && !await isCommunityMember(actor, targetCommunityId)) return "not_member_target";
  return "ok";
}
