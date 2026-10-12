import { describe, expect, it, vi } from "vitest";
import type { EtaQuery, EtaResult } from "../lib/ingest-client";
import type { OtpStopDeparturesData, OtpStoptime } from "../otp/types";
import { stopDepartures } from "./service";

// 2026-10-12 00:00 +08:00, the service day OTP reports for Taipei.
const SERVICE_DAY = Date.parse("2026-10-12T00:00:00+08:00") / 1000;
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 3600 + (m ?? 0) * 60;
};

function stoptime(route: string, dep: string, extra: Partial<OtpStoptime> = {}): OtpStoptime {
  return {
    scheduledDeparture: at(dep),
    realtimeDeparture: null,
    realtime: false,
    realtimeState: "SCHEDULED",
    serviceDay: SERVICE_DAY,
    headsign: null,
    trip: {
      gtfsId: `tw:${route}-${dep}`,
      directionId: null,
      route: { gtfsId: `tw:${route}`, shortName: route, mode: "BUS" },
    },
    ...extra,
  };
}

function board(stoptimes: OtpStoptime[]): OtpStopDeparturesData {
  return {
    stop: {
      gtfsId: "tw:TPE15209",
      name: "臺北車站(忠孝)",
      code: null,
      lat: 25.046,
      lon: 121.517,
      vehicleMode: "BUS",
      stoptimesWithoutPatterns: stoptimes,
    },
  };
}

const eta = (etaSeconds: number | null): EtaResult => ({
  stopUid: "TPE15209",
  routeUid: "TPE10307",
  direction: 0,
  etaSeconds,
  stopStatus: etaSeconds === null ? 1 : 0,
  isLastBus: false,
  asOf: "2026-10-12T09:00:00+08:00",
});

function deps(stoptimes: OtpStoptime[], busEta: (q: EtaQuery[]) => Promise<(EtaResult | null)[]>) {
  return {
    otp: { query: vi.fn().mockResolvedValue(board(stoptimes)) },
    ingest: { busEta: vi.fn(busEta) },
    now: () => new Date("2026-10-12T09:00:00+08:00"),
  };
}

describe("stopDepartures", () => {
  it("asks once per route and direction, with the trip-leg key, and marks only the first departure live", async () => {
    const d = deps(
      [stoptime("TPE103070_0", "09:20"), stoptime("TPE103070_0", "09:05"), stoptime("TPE104710_1", "09:10")],
      async (qs) => qs.map((q) => (q.subRouteUid === "TPE103070" ? eta(240) : null)),
    );
    const out = await stopDepartures("tw:TPE15209", d);
    expect(d.ingest.busEta).toHaveBeenCalledTimes(1);
    expect(d.ingest.busEta.mock.calls[0]?.[0]).toEqual([
      { stopUid: "TPE15209", subRouteUid: "TPE103070", direction: 0 },
      { stopUid: "TPE15209", subRouteUid: "TPE104710", direction: 1 },
    ]);
    expect(out?.departures.map((x) => [x.routeId, x.realtime, x.live?.etaSeconds])).toEqual([
      ["tw:TPE103070_0", "live", 240],
      ["tw:TPE104710_1", "scheduled", undefined],
      ["tw:TPE103070_0", "scheduled", undefined],
    ]);
  });

  it("skips departures that already have realtime data and non-bus routes", async () => {
    const d = deps(
      [
        stoptime("TPE103070_0", "09:05", { realtime: true, realtimeDeparture: at("09:07") }),
        stoptime("TRA_123_0_1", "09:06", {
          trip: {
            gtfsId: "tw:t",
            directionId: "0",
            route: { gtfsId: "tw:TRA_123_0_1", shortName: null, mode: "RAIL" },
          },
        }),
      ],
      async (qs) => qs.map(() => eta(60)),
    );
    const out = await stopDepartures("tw:TPE15209", d);
    expect(d.ingest.busEta.mock.calls[0]?.[0] ?? []).toEqual([]);
    expect(out?.departures[0]).toMatchObject({ realtime: "scheduled", routeId: "tw:TRA_123_0_1" });
    expect(out?.departures[1]).toMatchObject({ realtime: "live", estimated: "2026-10-12T01:07:00.000Z" });
    expect(out?.departures[1]?.live).toBeUndefined();
  });

  it("splits large boards into batches of 50 and shows the timetable when ingest fails", async () => {
    const many = Array.from({ length: 60 }, (_, i) => stoptime(`TPE1${String(i).padStart(4, "0")}0_0`, "09:30"));
    const ok = deps(many, async (qs) => qs.map(() => eta(120)));
    const out = await stopDepartures("tw:TPE15209", ok);
    expect(ok.ingest.busEta.mock.calls.map((c) => c[0].length)).toEqual([50, 10]);
    expect(out?.departures.every((x) => x.live?.etaSeconds === 120)).toBe(true);

    const down = deps(many.slice(0, 2), async () => {
      throw new Error("ingest down");
    });
    const fallback = await stopDepartures("tw:TPE15209", down);
    expect(fallback?.departures.map((x) => x.realtime)).toEqual(["scheduled", "scheduled"]);
  });
});
