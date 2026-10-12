import type { BikeStation, Leg, RouteInfo } from "@twc/contracts";
import { describe, expect, it, vi } from "vitest";
import { itineraryWithVia } from "../otp/fixtures";
import { addDockRisk, assessDockRisk } from "./dock-risk";
import { etaQueryForLeg, overlayLiveBus } from "./live-overlay";
import { mapItinerary } from "./map";
import { addTpassCoverage, toFareLeg } from "./tpass";

const base = mapItinerary(itineraryWithVia, "x-0");
function legAt(i: number) {
  const leg = base.legs[i];
  if (!leg) throw new Error(`fixture has no leg ${i}`);
  return leg;
}
const busLegIndex = 4;

describe("live bus overlay", () => {
  it("derives TDX ids from OTP ids", () => {
    expect(etaQueryForLeg(legAt(busLegIndex))).toEqual({
      stopUid: "TPE10001",
      subRouteUid: "TPE10307",
      toStopUid: "TPE10002",
    });
    expect(etaQueryForLeg(legAt(1))).toBeNull();
  });

  it("attaches ETAs to bus legs leaving soon", async () => {
    const busEta = vi
      .fn()
      .mockResolvedValue([{ etaSeconds: 360, asOf: "2026-10-11T11:00:00+08:00", isLastBus: false }]);
    const [out] = await overlayLiveBus([base], { busEta }, new Date("2026-10-11T11:00:00+08:00"), 45);
    expect(busEta).toHaveBeenCalledWith([{ stopUid: "TPE10001", subRouteUid: "TPE10307", toStopUid: "TPE10002" }]);
    expect(out?.legs[busLegIndex]).toMatchObject({ realtime: "live", live: { etaSeconds: 360, source: "tdx-eta" } });
  });

  it("does not show the next bus's ETA on a leg that waits for a later bus", async () => {
    // The leg boards at 11:10; TDX's next bus is due 10:55, 15 minutes earlier: a different bus.
    const busEta = vi.fn().mockResolvedValue([{ etaSeconds: 60, asOf: "2026-10-11T10:54:00+08:00", isLastBus: false }]);
    const [out] = await overlayLiveBus([base], { busEta }, new Date("2026-10-11T10:54:00+08:00"), 45);
    expect(out?.legs[busLegIndex]?.realtime).toBe("scheduled");
    expect(out?.legs[busLegIndex]?.live).toBeUndefined();
  });

  it("skips legs far in the future and survives ingest errors", async () => {
    const busEta = vi.fn().mockRejectedValue(new Error("down"));
    const early = await overlayLiveBus([base], { busEta }, new Date("2026-10-11T08:00:00+08:00"), 45);
    expect(busEta).not.toHaveBeenCalled();
    expect(early[0]).toBe(base);
    const failed = await overlayLiveBus([base], { busEta }, new Date("2026-10-11T11:00:00+08:00"), 45);
    expect(failed[0]?.legs[busLegIndex]?.realtime).toBe("scheduled");
  });
});

describe("dock risk", () => {
  const bikeLeg = legAt(0);
  const now = new Date("2026-10-11T08:55:00+08:00");

  it("flags few bikes and no docks", () => {
    expect(assessDockRisk(bikeLeg, now)).toEqual({
      level: "high",
      reasons: ["few_bikes_at_pickup", "no_docks_at_dropoff"],
    });
    expect(assessDockRisk(legAt(1), now)).toBeUndefined();
  });

  it("adds a long-lead reason when the ride is far off", () => {
    expect(assessDockRisk(bikeLeg, new Date("2026-10-11T08:00:00+08:00"))?.reasons).toContain("long_lead_time");
  });

  it("suggests a nearby backup with free docks", async () => {
    const station = (id: string, docks: number, status: BikeStation["status"] = "active") => ({
      id,
      name: { zh: id },
      lat: 25.033,
      lon: 121.544,
      serviceType: "youbike2" as const,
      capacity: 20,
      bikes: 5,
      ebikes: 0,
      docks,
      status,
      updatedAt: null,
      distanceMeters: 100,
    });
    const bikesNearby = vi
      .fn()
      .mockResolvedValue([station("youbike2:TPE500101099", 0), station("A", 9, "suspended"), station("B", 6)]);
    const [out] = await addDockRisk([base], { bikesNearby }, now);
    expect(out?.legs[0]?.dockRisk?.backup?.stationId).toBe("B");
  });
});

describe("TPASS coverage", () => {
  it("describes legs for the fare engine", () => {
    expect(toFareLeg(legAt(0))).toEqual({ tpassMode: "bike_share", fromCity: "Taipei", toCity: "Taipei" });
    expect(toFareLeg(legAt(1))).toEqual({ tpassMode: "metro", fromCity: "Taipei", toCity: "Taipei" });
    expect(toFareLeg(legAt(2)).tpassMode).toBeNull();
    expect(toFareLeg(legAt(busLegIndex))).toEqual({ tpassMode: "city_bus", fromCity: "Taipei", toCity: "Taipei" });
  });

  it("marks the whole trip as covered by 基北北桃", () => {
    expect(addTpassCoverage([base], "kpntp")[0]?.tpass).toEqual({ passId: "kpntp", coverage: "covered" });
    expect(addTpassCoverage([base], undefined)[0]?.tpass).toBeUndefined();
  });

  // Route rows as the TDX national GTFS has them (routes.txt + agency.txt).
  const rail = (route: RouteInfo): Leg => ({ ...legAt(1), mode: "RAIL", route });
  const coverageOf = (leg: Leg, passId: string) =>
    addTpassCoverage([{ ...base, legs: [leg] }], passId)[0]?.tpass?.coverage;

  it("recognises high-speed rail in the TDX feed and never covers it", () => {
    const hsr = rail({ id: "tw:THSR_0108_1", agencyName: "臺灣高速鐵路股份有限公司", longName: "左營-南港" });
    expect(toFareLeg(hsr)).toEqual({ tpassMode: "thsr", fromCity: null, toCity: null });
    expect(coverageOf(hsr, "tchhm")).toBe("not_covered");
    expect(toFareLeg(rail({ id: "tw:THSR_0108_1" })).tpassMode).toBe("thsr");
    expect(toFareLeg(rail({ id: "other:0108", agencyName: "臺灣高速鐵路股份有限公司" })).tpassMode).toBe("thsr");
  });

  it("keeps TRA trains as local trains", () => {
    const tra = rail({ id: "tw:TRA_1004_0_1132", agencyName: "交通部臺灣鐵路管理局", longName: "埔心-七堵" });
    expect(toFareLeg(tra)).toEqual({ tpassMode: "tra_local", fromCity: null, toCity: null });
  });

  it("covers a Hsinchu City to Hsinchu County bus with 桃竹竹苗", () => {
    const bus = legAt(busLegIndex);
    const hsinchuBus: Leg = {
      ...bus,
      from: { ...bus.from, stopId: "tw:HSZ291307" },
      to: { ...bus.to, stopId: "tw:HSQ296110" },
    };
    expect(toFareLeg(hsinchuBus)).toEqual({ tpassMode: "city_bus", fromCity: "Hsinchu", toCity: "HsinchuCounty" });
    expect(coverageOf(hsinchuBus, "tchhm")).toBe("covered");
    expect(coverageOf(hsinchuBus, "kpntp")).toBe("not_covered");
  });
});
