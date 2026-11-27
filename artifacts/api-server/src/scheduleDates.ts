import { scheduleDateSchema, type ReplaceContractSchedule } from "@workspace/db";

export function todayInDenver(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Denver" });
}

export function dayNumber(value: string): number {
  return Date.parse(`${scheduleDateSchema.parse(value)}T00:00:00Z`) / 86400000;
}

export function validateScheduleWindows(
  contract: { startDate: string; endDate: string }, service: ReplaceContractSchedule["services"][number],
): string | null {
  const { name, kind, windows } = service;
  if (kind === "counted" && (windows.length < 1 || windows.length > 12)) return `${name} must have 1–12 windows.`;
  if ((kind === "repeating" || kind === "as_needed") && windows.length > 1) return `${name} may have at most one window.`;
  if (kind === "on_request" && windows.length) return `${name} cannot have windows.`;
  for (const w of windows) {
    if (!scheduleDateSchema.safeParse(w.startDate).success || !scheduleDateSchema.safeParse(w.endDate).success) return `Invalid calendar date for ${name}.`;
    if (w.startDate > w.endDate) return `Window for ${name} starts after it ends.`;
    if (w.endDate < contract.startDate || w.endDate > contract.endDate) {
      return `Window for ${name} ends ${w.endDate}, outside the contract year ${contract.startDate} – ${contract.endDate}.`;
    }
    if (dayNumber(w.startDate) < dayNumber(contract.startDate) - 92 || w.startDate > contract.endDate) {
      return `Window for ${name} starts ${w.startDate}, outside the allowed contract window.`;
    }
  }
  return null;
}

export type WindowState = "done" | "upcoming" | "open" | "overdue" | "in_season" | "past";
export function windowState(
  window: { startDate: string; endDate: string; kind: string },
  completion: { undoneAt?: Date | null } | null | undefined,
  today: string,
): WindowState {
  if (window.kind === "counted" && completion && !completion.undoneAt) return "done";
  if (today < window.startDate) return "upcoming";
  if (window.kind === "counted") return today > window.endDate ? "overdue" : "open";
  return today > window.endDate ? "past" : "in_season";
}

export function scheduleSummary(services: {
  name: string; kind: string; windows: { state: WindowState; startDate: string }[];
}[]) {
  const windows = services.filter(s => s.kind === "counted").flatMap(s => s.windows.map(w => ({ ...w, serviceName: s.name })));
  const next = windows.filter(w => w.state === "upcoming").sort((a, b) => a.startDate.localeCompare(b.startDate) || a.serviceName.localeCompare(b.serviceName))[0];
  return {
    countedTotal: windows.length,
    done: windows.filter(w => w.state === "done").length,
    open: windows.filter(w => w.state === "open").length,
    overdue: windows.filter(w => w.state === "overdue").length,
    nextWindow: next ? { serviceName: next.serviceName, startDate: next.startDate } : null,
  };
}
