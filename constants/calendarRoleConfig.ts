export type CalendarUserRole = 'contractor' | 'hoa_admin' | 'hoa_member' | 'property_manager' | 'admin';

export type CalendarEventCategory = 'requests' | 'scheduled' | 'completed' | 'overdue';

export interface CalendarRoleConfig {
  showCategories: CalendarEventCategory[];
  showOverdueDotPerDay: boolean;
  showRequestDensityBadge: boolean;
  showOverdueClusterBadge: boolean;
  showMowingDots: boolean;
  showOverflowButton: boolean;
  anchorToToday: boolean;
}

const CONTRACTOR_CALENDAR_CONFIG: CalendarRoleConfig = {
  showCategories: ['scheduled', 'completed', 'overdue'],
  showOverdueDotPerDay: true,
  showRequestDensityBadge: false,
  showOverdueClusterBadge: false,
  showMowingDots: true,
  showOverflowButton: true,
  anchorToToday: true,
};

const HOA_ADMIN_CALENDAR_CONFIG: CalendarRoleConfig = {
  showCategories: ['requests', 'scheduled', 'completed', 'overdue'],
  showOverdueDotPerDay: true,
  showRequestDensityBadge: false,
  showOverdueClusterBadge: false,
  showMowingDots: false,
  showOverflowButton: true,
  anchorToToday: false,
};

const HOA_MEMBER_CALENDAR_CONFIG: CalendarRoleConfig = {
  showCategories: ['scheduled', 'completed'],
  showOverdueDotPerDay: false,
  showRequestDensityBadge: false,
  showOverdueClusterBadge: false,
  showMowingDots: false,
  showOverflowButton: false,
  anchorToToday: false,
};

const PROPERTY_MANAGER_CALENDAR_CONFIG: CalendarRoleConfig = {
  showCategories: ['requests', 'scheduled', 'completed', 'overdue'],
  showOverdueDotPerDay: false,
  showRequestDensityBadge: true,
  showOverdueClusterBadge: true,
  showMowingDots: false,
  showOverflowButton: true,
  anchorToToday: false,
};

const ADMIN_CALENDAR_CONFIG: CalendarRoleConfig = {
  showCategories: ['requests', 'scheduled', 'completed', 'overdue'],
  showOverdueDotPerDay: true,
  showRequestDensityBadge: false,
  showOverdueClusterBadge: false,
  showMowingDots: true,
  showOverflowButton: true,
  anchorToToday: false,
};

const CALENDAR_ROLE_CONFIGS: Record<CalendarUserRole, CalendarRoleConfig> = {
  contractor: CONTRACTOR_CALENDAR_CONFIG,
  hoa_admin: HOA_ADMIN_CALENDAR_CONFIG,
  hoa_member: HOA_MEMBER_CALENDAR_CONFIG,
  property_manager: PROPERTY_MANAGER_CALENDAR_CONFIG,
  admin: ADMIN_CALENDAR_CONFIG,
};

export function getCalendarRoleConfig(role: string | undefined | null): CalendarRoleConfig {
  const key = (role as CalendarUserRole) || 'contractor';
  return CALENDAR_ROLE_CONFIGS[key] ?? CALENDAR_ROLE_CONFIGS.contractor;
}

export default CALENDAR_ROLE_CONFIGS;
