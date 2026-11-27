/**
 * Central permission entry point: routes import from "../policy" and decide
 * permissions only through this module, never through individual policy files.
 *
 * actor: actor normalization and shared authorization errors.
 * community: general community access.
 * tasks: task reads, editing, completion and assignment.
 * hoa: HOA dashboards and requests.
 * portfolio: commercial portfolios and work orders.
 * assets: asset inventory, quality and notes.
 * maps: map layers, geometry and offline packs.
 * billing: invoices, reports and contracts.
 * files: file attachments and task-object access.
 * drive: drive role gates and community scope.
 * contacts: contact listing and changes.
 * communities: community lists, dashboards, search and crew.
 * users: user administration and portal-user scope.
 * schedules: service schedule reads and visit logging.
 */
export * from "./actor";
export * from "./community";
export * from "./tasks";
export * from "./hoa";
export * from "./portfolio";
export * from "./assets";
export * from "./maps";
export * from "./billing";
export * from "./files";
export * from "./drive";
export * from "./contacts";
export * from "./communities";
export * from "./users";
export * from "./schedules";
export * from "./schedule";
