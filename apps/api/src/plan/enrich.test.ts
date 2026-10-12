import type { BikeStation } from "@twc/contracts";
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
});
