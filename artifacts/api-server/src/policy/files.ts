import type { Actor } from "./actor";
import { isCommunityMember } from "./actor";

export function needsManagerTaskObjectCheck(actor: Actor): boolean {
  return actor.role === "contractor_manager";
}

export async function canAttachFileToCommunity(actor: Actor, communityId: string): Promise<boolean> {
  return actor.role === "admin" ||
    ((actor.role === "hoa_admin" || actor.role === "hoa_member") && actor.hoaCommunityId === communityId) ||
    isCommunityMember(actor, communityId);
}
