import type { Actor } from "./actor";
import { canAccessCommunity } from "./community";

export function canReadDrive(actor: Actor): boolean {
  return canChangeDrive(actor) || actor.role === "hoa_member";
}

export function canChangeDrive(actor: Actor): boolean {
  return actor.role === "admin" || actor.role === "property_manager" || actor.role === "hoa_admin";
}

export function canUseCommunityDrive(actor: Actor, communityId: string): Promise<boolean> {
  return canAccessCommunity(actor, communityId);
}
