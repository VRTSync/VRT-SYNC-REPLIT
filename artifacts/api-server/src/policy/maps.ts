import type { Actor } from "./actor";
import { canUseCommunityAssets } from "./assets";

/** Map payloads retain the same membership-only rule as asset reads. */
export function canUseCommunityMapData(actor: Actor, communityId: string): Promise<boolean> {
  return canUseCommunityAssets(actor, communityId);
}

export function canSeeInactiveAssetTypes(actor: Actor): boolean {
  return actor.role === "admin";
}

export function seesFullSearchIndex(actor: Actor): boolean {
  return actor.role === "admin";
}
