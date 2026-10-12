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

type Pattern = NonNullable<NonNullable<NonNullable<OtpStopDeparturesData["stop"]>["patterns"]>[number]>;

function board(stoptimes: OtpStoptime[], patterns: Pattern[] = []): OtpStopDeparturesData {
  return {
    stop: {
      gtfsId: "tw:TPE15209",
      name: "臺北車站(忠孝)",
      code: null,
      lat: 25.046,
      lon: 121.517,
      vehicleMode: "BUS",
      patterns,
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

function deps(
  stoptimes: OtpStoptime[],
  busEta: (q: EtaQuery[]) => Promise<(EtaResult | null)[]>,
  patterns: Pattern[] = [],
) {
  return {
    otp: { query: vi.fn().mockResolvedValue(board(stoptimes, patterns)) },
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

describe("stopDepartures for routes that run on headways", () => {
  it("shows the live ETA of a bus route OTP lists no stop times for", async () => {
    const pattern = (gtfsId: string, shortName: string, directionId: number): Pattern => ({
      directionId,
      headsign: "板橋前站",
      route: { gtfsId, shortName, mode: "BUS" },
    });
    const d = deps(
      [stoptime("TPE103070_0", "09:05")],
      async (qs) =>
        qs.map((q) => (q.subRouteUid === "TPE157462" ? { ...eta(336), asOf: "2026-10-12T09:00:00+08:00" } : null)),
      // 307莒光 runs only on headways (frequencies.txt); 307 also has timetabled trips listed above.
      [
        pattern("tw:TPE103070_0", "307", 0),
        pattern("tw:TPE157462_1", "307莒光往板橋前站", 1),
        pattern("tw:TPE99_0", "x", 0),
      ],
    );
    const out = await stopDepartures("tw:TPE15209", d);
    expect(d.ingest.busEta.mock.calls[0]?.[0]).toEqual([
      { stopUid: "TPE15209", subRouteUid: "TPE103070", direction: 0 },
      { stopUid: "TPE15209", subRouteUid: "TPE157462", direction: 1 },
      { stopUid: "TPE15209", subRouteUid: "TPE99", direction: 0 },
    ]);
    // The headway route appears with its live ETA; the route with timetabled trips keeps its row.
    expect(out?.departures.map((x) => [x.routeId, x.realtime, x.estimated ?? x.scheduled])).toEqual([
      ["tw:TPE103070_0", "scheduled", "2026-10-12T01:05:00.000Z"],
      ["tw:TPE157462_1", "live", "2026-10-12T01:05:36.000Z"],
    ]);
    expect(out?.departures[1]).toMatchObject({ routeShortName: "307莒光往板橋前站", headsign: "板橋前站" });
  });
});
