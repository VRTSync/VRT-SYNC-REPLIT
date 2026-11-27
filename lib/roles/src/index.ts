export const ROLES = [
  "admin", "property_manager", "hoa_admin", "hoa_member",
  "contractor_manager", "contractor", "client_admin", "map_creator",
] as const;
export type Role = typeof ROLES[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "VRTSync Staff",
  property_manager: "Property Manager",
  hoa_admin: "HOA Admin",
  hoa_member: "Board Member",
  contractor_manager: "Account Manager",
  contractor: "Crew Supervisor",
  client_admin: "Client",
  map_creator: "Map Creator",
};

export function roleLabel(role: string | null | undefined): string {
  return role && Object.hasOwn(ROLE_LABELS, role)
    ? ROLE_LABELS[role as Role] : "User";
}
