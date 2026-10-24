import type { HealthResponse } from "@twc/contracts";
import { describe, expect, it } from "vitest";
import { itineraryWithVia } from "../otp/fixtures";
import { applyEta } from "./live-overlay";
import { mapItinerary } from "./map";
import { feedOfStop, markSilentFeeds, serviceAlert, silentFeeds } from "./service-alert";

const feed = (name: string, healthy = true) => ({
  feed: name,
  lastSuccessAt: null,
  lastError: null,
  ageSeconds: 30,
  healthy,
});

const health: HealthResponse = {
  status: "ok",
  feeds: [feed("bus-eta:Hsinchu"), feed("bus-eta:HsinchuCounty"), feed("bus-eta:InterCity", false)],
  busLive: { Hsinchu: 0, HsinchuCounty: 41, InterCity: 0 },
};

describe("service alerts", () => {
  it("maps stops to their ETA feed", () => {
    expect(feedOfStop("tw:HSZ291311")).toBe("Hsinchu");
    expect(feedOfStop("HSQ310581")).toBe("HsinchuCounty");
    expect(feedOfStop("tw:THB268988")).toBe("InterCity");
    expect(feedOfStop("tw:TRA_1210")).toBeNull();
  });

  it("treats an up-to-date feed without a live bus as silent, only during service hours", () => {
    const noon = new Date("2026-10-24T12:00:00+08:00");
    // InterCity has no live bus either, but its data is stale, so it proves nothing.
    expect([...silentFeeds(health, noon)]).toEqual(["Hsinchu"]);
    expect(silentFeeds(health, new Date("2026-10-24T05:30:00+08:00")).size).toBe(0);
    expect(silentFeeds(health, new Date("2026-10-24T22:30:00+08:00")).size).toBe(0);
    expect(silentFeeds(null, noon).size).toBe(0);
  });

  it("explains why a bus may not run", () => {
    const silent = new Set(["Hsinchu"]);
    const eta = { stopUid: "HSQ1", routeUid: "R", direction: 0, etaSeconds: null, isLastBus: false, asOf: "" };
    expect(serviceAlert("tw:HSZ1", null, silent)).toBe("no_live_service");
    expect(serviceAlert("tw:HSQ1", { ...eta, stopStatus: 4 }, silent)).toBe("not_operating_today");
    expect(serviceAlert("tw:HSQ1", { ...eta, stopStatus: 1 }, silent)).toBeUndefined();
  });

  it("marks bus legs from a silent operator and TDX's not-operating-today", () => {
    const it0 = mapItinerary(itineraryWithVia, "x-0");
    const bus = it0.legs.findIndex((l) => l.mode === "BUS");
    const [out] = markSilentFeeds([it0], new Set(["Taipei"]), new Date("2026-10-11T10:00:00+08:00"));
    expect(out?.legs[bus]?.serviceAlert).toBe("no_live_service");
    // Five hours ahead is beyond what today's silence says.
    const [later] = markSilentFeeds([it0], new Set(["Taipei"]), new Date("2026-10-11T06:00:00+08:00"));
    expect(later?.legs[bus]?.serviceAlert).toBeUndefined();

    const leg = it0.legs[bus];
    if (!leg) throw new Error("fixture has no bus leg");
    const eta = { stopUid: "TPE10001", routeUid: "R", direction: 0, etaSeconds: null, isLastBus: false, asOf: "" };
    expect(applyEta(leg, { ...eta, stopStatus: 4 }).serviceAlert).toBe("not_operating_today");
  });
});
