import type { Actor } from "./actor";
import { isCommunityMember, isUnassignedHoa } from "./actor";
import * as storage from "../storage";

type InvoiceScope = { communityId: string; contractorCompanyId: string | null };
type InvoiceListPlan =
  | { kind: "denied" | "not_member" | "no_organization" | "community_required" }
  | { kind: "manager" | "all"; communityId?: string }
  | { kind: "community"; communityId: string }
  | { kind: "organization"; orgId: string };

/** This gate precedes the detail lookup, including a missing invoice's 404. */
export function canRequestInvoice(actor: Actor): boolean {
  return actor.role !== "contractor";
}

export async function invoiceListPlan(actor: Actor, {
  communityId,
}: { communityId?: string }): Promise<InvoiceListPlan> {
  if (isUnassignedHoa(actor)) return { kind: "denied" };
  if (!canRequestInvoice(actor)) return { kind: "denied" };
  if (hasFixedInvoiceCompany(actor)) {
    if (communityId && !await isCommunityMember(actor, communityId)) return { kind: "not_member" };
    return { kind: "manager", communityId };
  }
  if (actor.role === "admin") return { kind: "all", communityId: communityId || undefined };
  if ((actor.role === "hoa_admin" || actor.role === "hoa_member") && actor.hoaCommunityId) {
    return { kind: "community", communityId: actor.hoaCommunityId };
  }
  if (actor.role === "client_admin") {
    const orgId = actor.organizationId;
    if (!orgId) return { kind: "no_organization" };
    // The original route relies on enforceOrgScoping for a selected branch.
    return communityId ? { kind: "community", communityId } : { kind: "organization", orgId };
  }
  if (!communityId) return { kind: "community_required" };
  if (!await isCommunityMember(actor, communityId)) return { kind: "not_member" };
  return { kind: "community", communityId };
}

export async function invoiceReadAccess(actor: Actor, invoice: InvoiceScope): Promise<"ok" | "denied" | "no_organization"> {
  if (isUnassignedHoa(actor)) return "denied";
  if (!canRequestInvoice(actor)) return "denied";
  if (hasFixedInvoiceCompany(actor)) return await managerCanWriteInvoice(actor, invoice) ? "ok" : "denied";
  if (actor.role === "client_admin") {
    const orgId = actor.organizationId;
    if (!orgId) return "no_organization";
    const community = await storage.getCommunityById(invoice.communityId);
    return community && community.organizationId === orgId ? "ok" : "denied";
  }
  if (actor.role === "admin") return "ok";
  if ((actor.role === "hoa_admin" || actor.role === "hoa_member") && actor.hoaCommunityId) {
    return invoice.communityId === actor.hoaCommunityId ? "ok" : "denied";
  }
  return await isCommunityMember(actor, invoice.communityId) ? "ok" : "denied";
}

export function canManageInvoices(actor: Actor): boolean {
  return actor.role === "admin" || actor.role === "contractor_manager";
}

export function hasFixedInvoiceCompany(actor: Actor): boolean {
  return actor.role === "contractor_manager";
}

export async function managerCanCreateInvoice(actor: Actor, communityId: string): Promise<boolean> {
  return !!actor.companyId && await isCommunityMember(actor, communityId);
}

export async function managerCanWriteInvoice(actor: Actor, invoice: InvoiceScope): Promise<boolean> {
  return !!actor.companyId && actor.companyId === invoice.contractorCompanyId &&
    await isCommunityMember(actor, invoice.communityId);
}

export function invoiceStatusRule(actor: Actor, status: unknown, mode: "create" | "update"): "ok" | "staff_only" | "invalid" {
  if (!hasFixedInvoiceCompany(actor)) return "ok";
  if (status === "approved") return "staff_only";
  if (status === undefined) return "ok";
  const allowed = mode === "create" ? ["draft", "submitted"] : ["draft", "submitted", "paid", "void"];
  return typeof status === "string" && allowed.includes(status) ? "ok" : "invalid";
}

export async function canDeleteInvoice(actor: Actor, invoice: InvoiceScope & { status: string | null }): Promise<boolean> {
  return actor.role === "admin" || (await managerCanWriteInvoice(actor, invoice) && invoice.status === "draft");
}

export function canReadReports(actor: Actor): boolean {
  return ["admin", "property_manager", "hoa_admin", "hoa_member"].includes(actor.role);
}

export async function reportCommunity(actor: Actor, queryCommunityId?: string):
Promise<{ communityId: string } | "community_required" | "not_member"> {
  if (isUnassignedHoa(actor)) return "not_member";
  if (actor.role === "admin") return queryCommunityId ? { communityId: queryCommunityId } : "community_required";
  if ((actor.role === "hoa_admin" || actor.role === "hoa_member") && actor.hoaCommunityId) {
    return { communityId: actor.hoaCommunityId };
  }
  if (!queryCommunityId) return "community_required";
  return await isCommunityMember(actor, queryCommunityId) ? { communityId: queryCommunityId } : "not_member";
}

export function canReadContracts(actor: Actor): boolean {
  return actor.role === "admin" || actor.role === "property_manager";
}

export async function contractCommunityAccess(actor: Actor, communityId?: string):
Promise<"ok" | "community_required" | "not_member"> {
  if (actor.role === "admin") return "ok";
  if (!communityId) return "community_required";
  return await isCommunityMember(actor, communityId) ? "ok" : "not_member";
}

export function canHoldContract(user: Pick<Actor, "role">): boolean {
  return user.role === "contractor" || user.role === "contractor_manager";
}
