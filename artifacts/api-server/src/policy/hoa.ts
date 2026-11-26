import type { Actor } from "./actor";
import { canReadTask } from "./tasks";

export function hoaPortalCommunity(actor: Actor): string | null {
  return (actor.role === "hoa_admin" || actor.role === "hoa_member") && actor.hoaCommunityId
    ? actor.hoaCommunityId : null;
}

export function canReadHoaRequest(actor: Actor, task: Parameters<typeof canReadTask>[1]): Promise<boolean> {
  return canReadTask(actor, task);
}

export function canCreateHoaRequest(actor: Actor): boolean {
  return actor.role === "hoa_admin";
}

export function hoaRequestCommunity(actor: Actor): string | null {
  return actor.hoaCommunityId ?? null;
}
