import type { Actor } from "./actor";
import { isCommunityMember } from "./actor";
import * as storage from "../storage";

export async function canAccessCommunity(actor: Actor, communityId: string): Promise<boolean> {
  if (actor.role === "admin" || actor.role === "map_creator") return true;
  if (actor.role === "hoa_admin" || actor.role === "hoa_member") return actor.hoaCommunityId === communityId;
  if (actor.role === "client_admin") {
    const community = await storage.getCommunityById(communityId);
    return !!community?.organizationId && community.organizationId === actor.organizationId;
  }
  return isCommunityMember(actor, communityId);
}
