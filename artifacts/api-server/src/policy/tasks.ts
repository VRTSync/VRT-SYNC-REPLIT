import type { Task } from "@workspace/db";
import { isCommunityMember, type Actor } from "./actor";

type TaskRecord = Pick<Task, "assignedTo" | "communityId" | "contractorCompanyId">;
export type TaskEditLevel = "manager" | "manager_fixed_company" | "field" | null;
export type TaskListSurface = "list" | "page-data";

export async function canReadTask(actor: Actor, task: TaskRecord): Promise<boolean> {
  if (actor.role === "admin") return true;
  if (actor.role === "contractor") return task.assignedTo === actor.id && await isCommunityMember(actor, task.communityId);
  if (actor.role === "contractor_manager") {
    return !!actor.companyId && task.contractorCompanyId === actor.companyId && await isCommunityMember(actor, task.communityId);
  }
  if (actor.role === "hoa_admin" || actor.role === "hoa_member") return actor.hoaCommunityId === task.communityId;
  if (task.assignedTo === actor.id) return true;
  return isCommunityMember(actor, task.communityId);
}

/** The role gate precedes input validation in the existing create handler. */
export function canStartTaskCreation(actor: Actor): boolean {
  return ["admin", "property_manager", "contractor_manager"].includes(actor.role);
}

export async function canCreateTask(actor: Actor, communityId: string): Promise<boolean> {
  if (actor.role === "admin") return true;
  if (actor.role === "property_manager") return isCommunityMember(actor, communityId);
  return actor.role === "contractor_manager" && !!actor.companyId && await isCommunityMember(actor, communityId);
}

export async function taskEditLevel(actor: Actor, task: TaskRecord): Promise<TaskEditLevel> {
  if (!await canReadTask(actor, task)) return null;
  if (actor.role === "admin" || actor.role === "property_manager") return "manager";
  if (actor.role === "contractor_manager") return "manager_fixed_company";
  if (actor.role === "contractor" && task.assignedTo === actor.id) return "field";
  return null;
}

export async function canCompleteTask(actor: Actor, task: TaskRecord): Promise<boolean> {
  return await canReadTask(actor, task) && (actor.role === "admin" ||
    actor.role === "contractor_manager" || (actor.role === "contractor" && task.assignedTo === actor.id));
}

export function canDeleteTask(actor: Actor): boolean { return actor.role === "admin"; }
export function canEditTaskLink(actor: Actor): boolean { return actor.role === "admin"; }
export function canImportTasks(actor: Actor): boolean { return actor.role === "admin"; }
export function canBulkAssign(actor: Actor): boolean { return ["admin", "contractor_manager"].includes(actor.role); }

/**
 * Preserve the historical list/page-data difference for unassigned HOA users.
 * This is intentionally NOT the general community-access policy.
 */
export async function canListTasks(actor: Actor, communityId?: string | null, surface: TaskListSurface = "list"): Promise<boolean> {
  if (!communityId || actor.role === "admin") return true;
  if (actor.role === "hoa_admin" || actor.role === "hoa_member") {
    if (surface === "page-data" || actor.hoaCommunityId) return true;
  }
  return isCommunityMember(actor, communityId);
}

/** Select the old query path without putting authorization role checks in routes. */
export function taskListScope(actor: Actor, surface: TaskListSurface) {
  const hoa = actor.role === "hoa_admin" || actor.role === "hoa_member";
  return {
    hoaCommunityId: hoa ? actor.hoaCommunityId : null,
    communityWide: actor.role === "admin" || actor.role === "property_manager",
    allCommunities: actor.role === "admin",
    defaultCommunity: surface === "page-data"
      ? actor.role === "contractor" || actor.role === "contractor_manager"
      : actor.role !== "contractor_manager",
  };
}

export function hasFixedTaskCompany(actor: Actor): boolean { return actor.role === "contractor_manager"; }
export function canSetCompletedStatus(actor: Actor): boolean { return actor.role === "admin"; }
export function canEditHoaTaskPriority(actor: Actor): boolean { return actor.role !== "contractor"; }
export function canAcknowledgeHoaTask(actor: Actor): boolean { return ["contractor", "contractor_manager", "admin"].includes(actor.role); }
export function canCompleteOutsideTaskWindow(actor: Actor): boolean { return actor.role === "admin"; }
export function canAssignTaskTo(actor: Actor, assignee: { companyId: string | null }): boolean {
  return !hasFixedTaskCompany(actor) || assignee.companyId === actor.companyId;
}
