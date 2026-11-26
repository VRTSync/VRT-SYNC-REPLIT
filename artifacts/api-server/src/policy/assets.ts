import { isCommunityMember, type Actor } from "./actor";

export function canUseCommunityAssets(actor: Actor, communityId: string): Promise<boolean> {
  return actor.role === "admin" ? Promise.resolve(true) : isCommunityMember(actor, communityId);
}

export async function canDeleteAssetNote(actor: Actor, note: { createdBy: string }, communityId: string): Promise<boolean> {
  return actor.role === "admin" ||
    (note.createdBy === actor.id && await canUseCommunityAssets(actor, communityId));
}

export function assetHistoryCompanyScope(actor: Actor): string | undefined {
  return actor.role === "contractor_manager" ? actor.id : undefined;
}

export function usesMapCreatorPinPath(actor: Actor): boolean {
  return actor.role === "map_creator";
}

export function canCreateAdminAsset(actor: Actor): boolean {
  return actor.role === "admin";
}

export async function assetWriteAccess(
  actor: Actor, community: { id: string; isMapCreatorLocked?: boolean | null },
): Promise<"ok" | "not_member" | "locked"> {
  if (actor.role === "admin") return "ok";
  if (!await isCommunityMember(actor, community.id)) return "not_member";
  if (usesMapCreatorPinPath(actor) && community.isMapCreatorLocked) return "locked";
  return "ok";
}

export async function mapCreatorLockAccess(
  actor: Actor, communityId: string, locked: boolean,
): Promise<"ok" | "unlock_admin_only" | "not_member"> {
  if (usesMapCreatorPinPath(actor)) {
    if (locked === false) return "unlock_admin_only";
    if (!await isCommunityMember(actor, communityId)) return "not_member";
  }
  return "ok";
}
