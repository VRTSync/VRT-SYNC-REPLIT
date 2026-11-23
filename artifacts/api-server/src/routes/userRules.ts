import * as storage from "../storage";
import { isContractorSide, isHoaRole } from "../auth";

// Target-account validation, not caller authorization.
export { isHoaRole as targetHasHoaRole };

export async function checkHoaLimits(communityId: string, role: string, excludeUserId?: string): Promise<string | null> {
  const count = await storage.getHoaUserCountByCommunity(communityId, role, excludeUserId);
  if (role === 'hoa_admin' && count >= 1) {
    return 'This community already has an HOA Admin (limit: 1)';
  }
  if (role === 'hoa_member' && count >= 4) {
    return 'This community already has 4 HOA Members (limit: 4)';
  }
  return null;
}

/** Return the specified public validation error without changing access rules. */
export async function companySelectionError(role: string, companyId: unknown): Promise<string | null> {
  if (role === "contractor_manager" && !companyId) return "Account managers must have a contractor company";
  if (companyId === undefined || companyId === null) return null;
  if (!isContractorSide(role) && role !== "property_manager") return "Only contractors and property managers can have a company";
  if (typeof companyId !== "string" || !companyId) return "Company not found";
  const company = await storage.getCompanyById(companyId);
  if (!company?.isActive) return "Company not found";
  if (company.kind !== (isContractorSide(role) ? "contractor" : "management_company")) return "Company type does not match the user's role";
  return null;
}

export function companyUniqueConflict(error: any): boolean {
  return error?.code === "23505" || error?.cause?.code === "23505";
}
