import type { IconName } from "./shell/icons";

export interface NavItem { label: string; icon: IconName; href: string; app?: boolean }
export interface NavGroup { heading?: string; items: NavItem[] }

const dash: NavItem = { label: "Dashboard", icon: "grid", href: "/", app: true };

function admin(): NavGroup[] {
  const b = "/web/admin";
  return [
    { heading: "Overview", items: [dash] },
    { heading: "Communities", items: [
      { label: "Communities", icon: "building", href: b + "/communities" },
      { label: "Client Organizations", icon: "briefcase", href: b + "/organizations" },
    ] },
    { heading: "People", items: [
      { label: "Users", icon: "users", href: b + "/users" },
      { label: "Contacts", icon: "contact", href: b + "/contacts" },
    ] },
    { heading: "Contracts and billing", items: [
      { label: "Contracts", icon: "file", href: b + "/contracts" },
      { label: "Invoices", icon: "dollar", href: b + "/invoices" },
      { label: "Reports", icon: "bar", href: b + "/reports" },
    ] },
    { heading: "Setup", items: [
      { label: "Templates", icon: "template", href: b + "/templates" },
      { label: "Asset Types", icon: "layers", href: b + "/asset-types" },
      { label: "Xeriscape Planner", icon: "leaf", href: b + "/xeriscape-planner" },
    ] },
    { heading: "Data", items: [
      { label: "Import Tasks", icon: "upload", href: b + "/imports/contract-tasks" },
      { label: "Data Import", icon: "database", href: b + "/imports/seed" },
      { label: "Exports", icon: "download", href: b + "/exports" },
    ] },
    { heading: "Scheduling (retiring)", items: [
      { label: "Task Auto-Generate", icon: "refresh", href: b + "/schedules" },
      { label: "Mowing & Service Days", icon: "calendar", href: b + "/service-schedules" },
    ] },
  ];
}

const it = (base: string, label: string, icon: IconName, path: string): NavItem => ({ label, icon, href: base + path });

export function navFor(role: string): NavGroup[] {
  switch (role) {
    case "admin": return admin();
    case "property_manager": { const b = "/web/pm"; return [{ items: [dash,
      it(b, "Tasks", "check", "/tasks"), it(b, "Map", "map", "/map"), it(b, "Invoices", "dollar", "/invoices"),
      it(b, "Documents", "file", "/documents"), it(b, "Reports", "bar", "/reports"), it(b, "Users", "users", "/users"),
      it(b, "Contacts", "contact", "/contacts")] }]; }
    case "hoa_admin": { const b = "/web/hoa"; return [{ items: [dash,
      it(b, "Tasks", "check", "/tasks"), it(b, "Requests", "inbox", "/requests"), it(b, "Map", "map", "/map"),
      it(b, "Invoices", "dollar", "/invoices"), it(b, "Documents", "file", "/documents"), it(b, "Reports", "bar", "/reports"),
      it(b, "Users", "users", "/users"), it(b, "Contacts", "contact", "/contacts")] }]; }
    case "hoa_member": { const b = "/web/hoa"; return [{ items: [dash,
      it(b, "Requests", "inbox", "/requests"), it(b, "Map", "map", "/map"), it(b, "Invoices", "dollar", "/invoices"),
      it(b, "Documents", "file", "/documents"), it(b, "Reports", "bar", "/reports"), it(b, "Contacts", "contact", "/contacts")] }]; }
    case "contractor_manager": { const b = "/web/contractor"; return [{ items: [dash,
      it(b, "Tasks", "check", "/tasks"), it(b, "Map", "map", "/map"), it(b, "Service Schedule", "calendar", "/service-schedule")] }]; }
    case "contractor": { const b = "/web/contractor"; return [{ items: [dash,
      it(b, "My Tasks", "check", "/tasks"), it(b, "Map", "map", "/map"), it(b, "Service Schedule", "calendar", "/service-schedule")] }]; }
    default: return [{ items: [dash] }];
  }
}

export interface PlusAction { label: string; href: string; icon: IconName }
export function plusActionsFor(role: string): PlusAction[] {
  switch (role) {
    case "admin": return [
      { label: "Create user", href: "/web/admin/users?action=create_user", icon: "user" },
      { label: "New community", href: "/web/admin/communities?action=new_community", icon: "building" },
    ];
    case "property_manager": return [{ label: "Create task", href: "/web/pm/tasks?action=create_task", icon: "check" }];
    case "hoa_admin": return [{ label: "New request", href: "/web/hoa/requests?action=create_request", icon: "inbox" }];
    default: return [];
  }
}
