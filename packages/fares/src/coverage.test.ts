import { describe, expect, it } from "vitest";
import { cityFromUid } from "./cities";
import { evaluateCoverage, type FareLeg } from "./coverage";
import { findPass, TPASS_PASSES } from "./tpass";

const kpntp = findPass("kpntp");
if (!kpntp) throw new Error("kpntp missing");

const walk: FareLeg = { tpassMode: null, fromCity: null, toCity: null };
const bus = (from: FareLeg["fromCity"], to: FareLeg["toCity"]): FareLeg => ({
  tpassMode: "city_bus",
  fromCity: from,
  toCity: to,
});

describe("evaluateCoverage", () => {
  it("treats walk-only trips as covered (nothing to pay)", () => {
    expect(evaluateCoverage(kpntp, [walk])).toBe("covered");
  });

  it("covers trips entirely inside the region", () => {
    expect(
      evaluateCoverage(kpntp, [
        walk,
        bus("Taipei", "NewTaipei"),
        { tpassMode: "metro", fromCity: "NewTaipei", toCity: "Taipei" },
      ]),
    ).toBe("covered");
  });

  it("never covers THSR", () => {
    expect(evaluateCoverage(kpntp, [{ tpassMode: "thsr", fromCity: "Taipei", toCity: "Taoyuan" }])).toBe("not_covered");
  });

  it("is partial when one leg leaves the region", () => {
    expect(
      evaluateCoverage(kpntp, [
        bus("Taipei", "Taipei"),
        { tpassMode: "intercity_bus", fromCity: "Taipei", toCity: "YilanCounty" },
      ]),
    ).toBe("partial");
  });

  it("is unknown when a leg cannot be placed in a city", () => {
    expect(
      evaluateCoverage(kpntp, [bus("Taipei", "Taipei"), { tpassMode: "tra_local", fromCity: null, toCity: "Taipei" }]),
    ).toBe("unknown");
  });

  it("does not cover modes the pass excludes", () => {
    const tchhm = findPass("tchhm");
    expect(
      tchhm && evaluateCoverage(tchhm, [{ tpassMode: "bike_share", fromCity: "Taoyuan", toCity: "Taoyuan" }]),
    ).toBe("not_covered");
  });
});

describe("cityFromUid", () => {
  it("reads TDX city codes from plain and feed-prefixed ids", () => {
    expect(cityFromUid("TPE12345")).toBe("Taipei");
    expect(cityFromUid("tw:NWT1234")).toBe("NewTaipei");
    expect(cityFromUid("tw:1000")).toBeNull();
    expect(cityFromUid(undefined)).toBeNull();
  });
});

describe("TPASS data", () => {
  it("cites a source for every pass and has unique ids", () => {
    for (const pass of TPASS_PASSES) expect(pass.sources.length).toBeGreaterThan(0);
    expect(new Set(TPASS_PASSES.map((p) => p.id)).size).toBe(TPASS_PASSES.length);
  });
});
