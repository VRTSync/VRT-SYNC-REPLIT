import type { Request } from "express";
import type { User } from "@workspace/db";
import * as storage from "../storage";

export type Actor = Pick<User, "id" | "role" | "companyId" | "hoaCommunityId" | "organizationId">;
type MembershipCache = Map<string, Promise<boolean>>;
const requestMemberships = Symbol("policyMemberships");
const actorMemberships = new WeakMap<Actor, MembershipCache>();

export class UnauthenticatedError extends Error {
  constructor() { super("Not authenticated"); }
}

export class ForbiddenError extends Error {}

export function actorFromUser(user: Actor): Actor {
  return {
    id: user.id, role: user.role, companyId: user.companyId ?? null,
    hoaCommunityId: user.hoaCommunityId ?? null, organizationId: user.organizationId ?? null,
  };
}

export function actorFrom(req: Request): Actor {
  if (!req.currentUser) throw new UnauthenticatedError();
  const request = req as Request & { [requestMemberships]?: MembershipCache };
  const cache = request[requestMemberships] ??= new Map();
  const actor = actorFromUser(req.currentUser);
  actorMemberships.set(actor, cache);
  return actor;
}

export function isUnassignedHoa(actor: Actor): boolean {
  return (actor.role === "hoa_admin" || actor.role === "hoa_member") && !actor.hoaCommunityId;
}

/** Cache the promise too, so concurrent policy checks share one lookup. */
export function isCommunityMember(actor: Actor, communityId: string): Promise<boolean> {
  if (isUnassignedHoa(actor)) return Promise.resolve(false);
  let cache = actorMemberships.get(actor);
  if (!cache) { cache = new Map(); actorMemberships.set(actor, cache); }
  // Include actor identity so changing the request's actor cannot reuse a grant.
  const key = JSON.stringify([actor.id, communityId]);
  if (!cache.has(key)) cache.set(key, storage.isUserMemberOfCommunity(actor.id, communityId));
  return cache.get(key)!;
}

export function assertCan(decision: boolean, message: string): asserts decision {
  if (!decision) throw new ForbiddenError(message);
}
