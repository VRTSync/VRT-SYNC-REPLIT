import type { Actor } from "./actor";
import { canAccessCommunity } from "./community";

export async function canViewServiceSchedules(actor: Actor, communityId: string): Promise<boolean> {
  return canAccessCommunity(actor, communityId);
}

export async function canLogServiceVisit(actor: Actor, communityId: string): Promise<boolean> {
  return (actor.role === "admin" || actor.role === "contractor") &&
    canAccessCommunity(actor, communityId);
}
