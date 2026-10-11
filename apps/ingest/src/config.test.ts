import { describe, expect, it } from "vitest";
import { estimatedCallsPerMinute, loadConfig } from "./config";

const creds = { TDX_CLIENT_ID: "id", TDX_CLIENT_SECRET: "secret" };

describe("loadConfig", () => {
  it("defaults to one city that fits the free TDX plan (5 requests/minute)", () => {
    const c = loadConfig(creds);
    expect(c.BUS_CITIES).toEqual(["Taipei"]);
    expect(c.BIKE_CITIES).toEqual(["Taipei"]);
    expect(estimatedCallsPerMinute(c)).toBeLessThanOrEqual(c.TDX_RATE_PER_MINUTE);
  });

  it("expands 'all'", () => {
    expect(loadConfig({ ...creds, BUS_CITIES: "all" }).BUS_CITIES).toHaveLength(22);
  });

  it("parses city lists and rejects unknown cities", () => {
    expect(loadConfig({ ...creds, BUS_CITIES: "Taipei, NewTaipei" }).BUS_CITIES).toEqual(["Taipei", "NewTaipei"]);
    expect(() => loadConfig({ ...creds, BUS_CITIES: "Atlantis" })).toThrow(/Unknown cities/);
  });

  it("requires TDX credentials", () => {
    expect(() => loadConfig({})).toThrow(/TDX_CLIENT_ID/);
  });

  it("estimates TDX call volume independent of users", () => {
    const c = loadConfig({ ...creds, BUS_CITIES: "Taipei", BUS_INTERCITY: "false", BIKE_CITIES: "Taipei" });
    // per minute: 60/60 bus ETA + 60/120 bike availability + 60/21600 bike stations + 60/43200 bus routes + 60/120 TRA
    expect(estimatedCallsPerMinute(c)).toBeCloseTo(1 + 0.5 + 60 / 21600 + 60 / 43200 + 0.5, 6);
  });
});
