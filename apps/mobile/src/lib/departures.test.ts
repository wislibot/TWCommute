import type { Departure, StopSummary } from "@twc/contracts";
import { describe, expect, it } from "vitest";
import { groupStopsByName, minutesFromNow, nextByRoute } from "./departures";

const stop = (id: string, name: string, distanceMeters: number, mode: StopSummary["modes"][number] = "BUS") => ({
  id,
  name,
  lat: 24.8,
  lon: 120.97,
  distanceMeters,
  modes: [mode],
});

const dep = (route: string, at: string, extra: Partial<Departure> = {}): Departure => ({
  routeId: `tw:${route}`,
  routeShortName: route,
  mode: "BUS",
  headsign: "竹東",
  scheduled: at,
  realtime: "scheduled",
  ...extra,
});

describe("nearby departures", () => {
  it("groups same-name stops, nearest first, within a budget of stop ids", () => {
    const groups = groupStopsByName(
      [
        stop("a", "新竹站", 90),
        stop("b", "新竹轉運站", 140),
        stop("c", "新竹站", 150),
        stop("d", "火車站", 160, "RAIL"),
      ],
      3,
    );
    expect(groups.map((g) => [g.name, g.ids])).toEqual([
      ["新竹站", ["a", "c"]],
      ["新竹轉運站", ["b"]],
    ]);
  });

  it("keeps the next departure per route and direction, live times first", () => {
    const now = Date.parse("2026-10-24T07:00:00Z");
    const deps = [
      dep("182", "2026-10-24T07:20:00Z"),
      dep("182", "2026-10-24T07:05:00Z"),
      dep("5608", "2026-10-24T07:30:00Z", {
        realtime: "live",
        live: { etaSeconds: 240, asOf: "2026-10-24T07:00:00Z", source: "tdx-eta" },
      }),
      dep("182", "2026-10-24T07:10:00Z", { headsign: "清華大學" }),
      dep("1", "2026-10-24T06:50:00Z"),
    ];
    const next = nextByRoute(deps, now, 5);
    expect(next.map((d) => `${d.routeShortName}>${d.headsign}`)).toEqual(["5608>竹東", "182>竹東", "182>清華大學"]);
    expect(next.map((d) => minutesFromNow(d, now))).toEqual([4, 5, 10]);
    expect(nextByRoute(deps, now, 1)).toHaveLength(1);
  });
});
