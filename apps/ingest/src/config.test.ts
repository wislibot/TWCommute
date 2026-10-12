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

  it("parses BUS_INTERCITY_ROUTES: the whole feed by default, 'auto', or a list of RouteUIDs", () => {
    expect(loadConfig(creds).BUS_INTERCITY_ROUTES).toEqual([]);
    expect(loadConfig({ ...creds, BUS_INTERCITY_ROUTES: "auto" }).BUS_INTERCITY_ROUTES).toBe("auto");
    expect(loadConfig({ ...creds, BUS_INTERCITY_ROUTES: "THB5608, THB9003," }).BUS_INTERCITY_ROUTES).toEqual([
      "THB5608",
      "THB9003",
    ]);
    // Only RouteUIDs that are safe to put in a TDX $filter as they are.
    expect(() => loadConfig({ ...creds, BUS_INTERCITY_ROUTES: "THB5608,thb9003" })).toThrow(
      /Invalid RouteUIDs: thb9003/,
    );
    expect(() => loadConfig({ ...creds, BUS_INTERCITY_ROUTES: "THB5608' or 1 eq 1" })).toThrow(/Invalid RouteUIDs/);
  });

  it("requires TDX credentials", () => {
    expect(() => loadConfig({})).toThrow(/TDX_CLIENT_ID/);
  });

  it("estimates TDX call volume independent of users", () => {
    const c = loadConfig({ ...creds, BUS_CITIES: "Taipei", BUS_INTERCITY: "false", BIKE_CITIES: "Taipei" });
    // per minute: 60/60 bus ETA + 60/120 bike availability + 60/21600 bike stations + 60/43200 bus routes + 60/120 TRA
    expect(estimatedCallsPerMinute(c)).toBeCloseTo(1 + 0.5 + 60 / 21600 + 60 / 43200 + 0.5, 6);
  });

  it("keeps the Hsinchu preset (two cities and intercity buses) within the free plan", () => {
    const c = loadConfig({
      ...creds,
      BUS_CITIES: "Hsinchu,HsinchuCounty",
      BIKE_CITIES: "Hsinchu,HsinchuCounty",
      BUS_INTERCITY: "true",
      BUS_INTERCITY_ROUTES: "auto",
      BIKE_AVAILABILITY_INTERVAL_S: "180",
    });
    // per minute: 3 bus ETA feeds + 2 × 60/180 bike availability + 60/120 TRA + the slow lists ≈ 4.18
    expect(estimatedCallsPerMinute(c)).toBeCloseTo(3 + 2 / 3 + 0.5 + (2 * 60) / 21600 + (3 * 60) / 43200, 6);
    expect(estimatedCallsPerMinute(c)).toBeLessThan(5);
  });
});
