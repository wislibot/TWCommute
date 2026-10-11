import { describe, expect, it } from "vitest";
import { estimatedCallsPerSecond, loadConfig } from "./config";

const creds = { TDX_CLIENT_ID: "id", TDX_CLIENT_SECRET: "secret" };

describe("loadConfig", () => {
  it("defaults to all cities", () => {
    const c = loadConfig(creds);
    expect(c.BUS_CITIES).toHaveLength(22);
    expect(c.BIKE_CITIES).toHaveLength(15);
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
    // 1/30 bus + 1/60 bike availability + 1/21600 bike stations + 1/60 TRA
    expect(estimatedCallsPerSecond(c)).toBeCloseTo(1 / 30 + 1 / 60 + 1 / 21600 + 1 / 60, 6);
  });
});
