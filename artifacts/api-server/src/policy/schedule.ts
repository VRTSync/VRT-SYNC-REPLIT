import type { Contract, ContractServiceCompletion } from "@workspace/db";
import type { Actor } from "./actor";
import { isCommunityMember, isUnassignedHoa } from "./actor";
import { canAccessCommunity } from "./community";
import { dayNumber, todayInDenver } from "../scheduleDates";

type Scope = Pick<Contract, "communityId" | "contractorCompanyId">;

export async function canReadCommunitySchedule(actor: Actor, communityId: string): Promise<boolean> {
  return actor.role !== "map_creator" && !isUnassignedHoa(actor) && canAccessCommunity(actor, communityId);
}

/** undefined means all companies; null means no visible company. */
export function visibleContractFilter(actor: Actor): string | null | undefined {
  return actor.role === "contractor" || actor.role === "contractor_manager" ? actor.companyId : undefined;
}
export function isContractVisible(actor: Actor, contract: Scope): boolean {
  const company = visibleContractFilter(actor);
  return company === undefined || (!!company && company === contract.contractorCompanyId);
}
export function seesContractPrices(actor: Actor): boolean { return actor.role !== "contractor"; }
export function canEditContractSchedule(actor: Actor): boolean { return actor.role === "admin"; }

// Mutation storage supplies membership read under a row lock. Reads use the
// request-scoped membership cache, not an extra query for every service/window.
export async function canCompleteContractService(actor: Actor, contract: Scope, member?: boolean): Promise<boolean> {
  if (actor.role === "admin") return true;
  if (actor.role !== "contractor" && actor.role !== "contractor_manager") return false;
  return !!actor.companyId && actor.companyId === contract.contractorCompanyId &&
    (member ?? await isCommunityMember(actor, contract.communityId));
}
export async function canUndoCompletion(
  actor: Actor, contract: Scope,
  completion: Pick<ContractServiceCompletion, "completedBy" | "createdAt">,
  today = todayInDenver(), member?: boolean,
): Promise<boolean> {
  if (actor.role === "admin") return true;
  if (!await canCompleteContractService(actor, contract, member)) return false;
  if (actor.role === "contractor_manager") return true;
  const age = dayNumber(today) - dayNumber(todayInDenver(completion.createdAt));
  return actor.id === completion.completedBy && age >= 0 && age <= 14;
}
