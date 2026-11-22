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

/** Preserve the existing session fallback in this behavior-only extraction. */
export function hoaRequestCommunity(actor: Actor, sessionHoaCommunityId?: string | null): string | null {
  return actor.hoaCommunityId || sessionHoaCommunityId || null;
}
