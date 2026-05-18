import { generateZoneLabel } from "../../lib/mcAutoLabel";

describe("generateZoneLabel", () => {
  it("returns Zone 1 when there are no existing zones", () => {
    const result = generateZoneLabel({
      parentControllerKey: "A",
      existingZoneNumbers: [],
    });
    expect(result).toEqual({ label: "Zone 1", zoneNumber: 1 });
  });

  it("returns Zone 2 when zone 1 already exists", () => {
    const result = generateZoneLabel({
      parentControllerKey: "A",
      existingZoneNumbers: [1],
    });
    expect(result).toEqual({ label: "Zone 2", zoneNumber: 2 });
  });

  it("returns max+1 when multiple sequential zones exist", () => {
    const result = generateZoneLabel({
      parentControllerKey: "B",
      existingZoneNumbers: [1, 2, 3],
    });
    expect(result).toEqual({ label: "Zone 4", zoneNumber: 4 });
  });

  it("uses max+1 not gap-filling when there are gaps", () => {
    const result = generateZoneLabel({
      parentControllerKey: "A",
      existingZoneNumbers: [1, 3],
    });
    expect(result).toEqual({ label: "Zone 4", zoneNumber: 4 });
  });

  it("handles unordered existing zone numbers correctly", () => {
    const result = generateZoneLabel({
      parentControllerKey: "C",
      existingZoneNumbers: [3, 1, 2],
    });
    expect(result).toEqual({ label: "Zone 4", zoneNumber: 4 });
  });

  it("parentControllerKey does not affect the output", () => {
    const resultA = generateZoneLabel({
      parentControllerKey: "A",
      existingZoneNumbers: [1, 2],
    });
    const resultZ = generateZoneLabel({
      parentControllerKey: "Z",
      existingZoneNumbers: [1, 2],
    });
    expect(resultA).toEqual(resultZ);
    expect(resultA).toEqual({ label: "Zone 3", zoneNumber: 3 });
  });
});
