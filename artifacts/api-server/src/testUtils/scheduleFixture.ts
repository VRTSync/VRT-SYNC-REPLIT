import type { ReplaceContractSchedule } from "@workspace/db";

/** The corrected Ute Creek fixture from the SC1 brief, not pilot/live data. */
export function uteCreekSchedule(): ReplaceContractSchedule {
  type S = ReplaceContractSchedule["services"][number];
  const service = (name: string, category: S["category"], kind: S["kind"], includedText: string,
    dates: string[][] = [], cadenceText?: string): S => ({
    name, category, kind, includedText, cadenceText, sortOrder: 0,
    windows: dates.map(([startDate, endDate]) => ({ startDate, endDate })),
  });
  const services = [
    service("Weekly turf service", "landscape", "repeating", "26 visits",
      [["2027-04-01", "2027-10-31"]], "Weekly May – Sep 2027; twice a month in Apr and Oct"),
    service("Spring core aeration", "landscape", "counted", "1", [["2027-03-01", "2027-05-15"]]),
    service("Clean-ups", "landscape", "counted", "2 visits", [["2026-11-01", "2026-11-30"], ["2027-03-01", "2027-04-15"]]),
    service("Shrub trimming", "landscape", "counted", "2 trims", [["2027-04-01", "2027-07-31"], ["2027-09-01", "2027-10-31"]]),
    service("Ornamental grass cutback", "landscape", "counted", "1", [["2026-12-01", "2027-01-30"]]),
    service("Light tree pruning", "tree", "counted", "1", [["2027-09-01", "2027-10-31"]]),
    service("Native grass areas", "landscape", "counted", "2 mows", [["2027-04-01", "2027-05-31"], ["2027-09-01", "2027-10-31"]]),
    service("Turf fertilization", "landscape", "counted", "3 applications", [["2027-03-01", "2027-04-30"], ["2027-06-01", "2027-07-31"], ["2027-08-15", "2027-09-30"]]),
    service("Broadleaf weed control", "landscape", "counted", "3 applications", [["2027-05-01", "2027-05-31"], ["2027-06-01", "2027-06-30"], ["2027-07-01", "2027-07-31"]]),
    service("Winter site visits", "landscape", "repeating", "Every other week"),
    service("Irrigation start-up", "irrigation", "counted", "1", [["2027-03-01", "2027-04-30"]]),
    service("Irrigation inspection", "irrigation", "repeating", "Monthly"),
    service("Irrigation winterization", "irrigation", "counted", "1", [["2026-10-01", "2026-11-30"]]),
    service("Backflow testing", "irrigation", "counted", "1", [["2027-01-01", "2027-10-31"]]),
    service("Snow removal and ice melt", "snow", "as_needed", "As needed"),
  ].map((s, sortOrder) => ({ ...s, sortOrder }));
  const rate = (label: string, amountCents: number, unit: string, note?: string) => ({
    label, amountCents, unit, note, sortOrder: 0,
  });
  return {
    services,
    rates: [
      rate("Additional aeration", 45000, "per fall aeration"),
      rate("Native-area broadleaf control", 7700, "per gallon applied"),
      rate("Irrigation labor", 8500, "per hour", "plus materials/parts"),
      rate("Repair without approval, up to", 50000, "per month"),
      rate("Backflow test", 14500, "per device"),
      rate("Crabgrass control", 50000, "per application", "on request, early June"),
      rate("Winter watering", 12500, "per hour"),
      rate("Plow truck", 14500, "per hour"),
      rate("ATV", 13500, "per hour"),
      rate("Snowblower", 10500, "per hour"),
      rate("Hand shovel", 7500, "per hour"),
      rate("Ice melt", 145, "per pound"),
      rate("Ice melt application", 7500, "per hour"),
      rate("Late payment finance charge", 0, "percent", "1.5% per month on payments past due 15 days"),
    ].map((r, sortOrder) => ({ ...r, sortOrder })),
  };
}
