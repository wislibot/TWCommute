/** Renderer tests on a synthetic report (not real data). */
import { describe, expect, it } from "vitest";
import { fmtLag, fmtPct, fmtRecord, renderMarkdown } from "./render";
import type { AuditReport } from "./types";

const empty: AuditReport = {
  generatedAt: "2026-10-11T10:00:00.000Z",
  cities: [],
  gtfs: [],
  cityPrefix: [],
  busMapping: [],
  eta: [],
  tra: null,
  youbike: [],
  tdx: { calls: 0, byStatus: {}, rateLimitHeaders: {} },
  errors: [],
};

describe("renderMarkdown", () => {
  it("renders an empty report without NaN or undefined", () => {
    const md = renderMarkdown(empty);
    expect(md.match(/_No data\._/g)).toHaveLength(5);
    expect(md).toContain("_Not run._");
    expect(md).toContain("_None._");
    expect(md).toContain("| 0 | — | — |");
    expect(md).not.toMatch(/NaN|undefined/);
    expect(md.endsWith("\n")).toBe(true);
  });

  it("renders every section and escapes table cells", () => {
    const md = renderMarkdown({
      ...empty,
      cities: ["Taipei"],
      busMapping: [
        {
          city: "Taipei",
          tdxStops: 2,
          stopUidInGtfs: 98.25,
          stopIdInGtfs: 0,
          stopInStopCode: null,
          tdxRoutes: 1,
          routeUidInGtfs: 100,
          subRouteUidInGtfs: null,
          subRouteDirInGtfs: 99,
          etaWithSubRoute: 100,
          etaRows: 3,
          etaJoinable: 66.7,
          bestHypothesis: "StopUID=stop_id (98.3%), RouteUID=route_id (100%)",
          samples: { tdxStopUids: [], tdxRouteUids: [], unmatchedEtaKeys: ["TPE1|TPE2"] },
        },
      ],
      tra: {
        traFeedFound: true,
        trainsIndexed: 10,
        stationsIndexed: 5,
        tripsWithStops: 20,
        delays: 4,
        matched: 3,
        offPattern: 1,
        unmatchedTrains: 1,
        unmatchedStations: 0,
        unmatchedSamples: { trains: ["9"], stations: [] },
        tdxStations: 5,
        tdxStationsMapped: 80,
      },
      tdx: { calls: 12, byStatus: { "200": 11, "429": 1 }, rateLimitHeaders: {} },
      errors: ["bus ETA Kaohsiung: TDX 429:\nslow down"],
    });
    expect(md).toContain("| Taipei | 2 | 98.3% | 0.0% | — | 1 | 100.0% | — | 99.0% | 3 | 100.0% | 66.7% |");
    expect(md).toContain("TPE1\\|TPE2");
    expect(md).toContain("3 (75.0%)");
    expect(md).toContain("200=11, 429=1");
    expect(md).toContain("- bus ETA Kaohsiung: TDX 429: slow down");
    expect(renderMarkdown(empty)).toBe(renderMarkdown(empty));
  });
});

describe("formatters", () => {
  it("formats percentages, lags and records", () => {
    expect(fmtPct(null)).toBe("—");
    expect(fmtPct(12)).toBe("12.0%");
    expect(fmtLag({ count: 0, p50: null, p90: null, max: null })).toBe("—");
    expect(fmtLag({ count: 3, p50: 12, p90: 40, max: 300 })).toBe("p50 12s · p90 40s · max 300s");
    expect(fmtRecord({ b: 2, a: 2, c: 5 })).toBe("c=5, a=2, b=2");
  });
});
