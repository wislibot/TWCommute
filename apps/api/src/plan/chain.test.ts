import { PlanRequest } from "@twc/contracts";
import { describe, expect, it, vi } from "vitest";
import type { OtpClient } from "../otp/client";
import type { OtpItinerary, OtpLeg, OtpPlace, OtpPlanData } from "../otp/types";
import { cursorTime, joinSegments, planWithStops } from "./chain";
import { mapItinerary } from "./map";

const t = (hhmm: string) => `2026-10-12T${hhmm}:00+08:00`;
const place = (name: string): OtpPlace => ({ name, lat: 25, lon: 121.5, stop: null, vehicleRentalStation: null });

/** A segment option: walk to a stop, ride, walk on. Times are HH:MM, Taipei. */
function option(from: string, to: string, leave: string, board: string, alight: string, arrive: string): OtpItinerary {
  const leg = (mode: string, a: string, b: string, start: string, end: string, transit = false): OtpLeg => ({
    mode,
    distance: 100,
    duration: 60,
    transitLeg: transit,
    rentedBike: false,
    realTime: false,
    realtimeState: transit ? "SCHEDULED" : null,
    headsign: null,
    start: { scheduledTime: t(start), estimated: null },
    end: { scheduledTime: t(end), estimated: null },
    from: place(a),
    to: place(b),
    route: transit
      ? { gtfsId: `tw:${from}-${board}`, shortName: board, longName: null, color: null, textColor: null, agency: null }
      : null,
    trip: null,
    legGeometry: null,
  });
  return {
    start: t(leave),
    end: t(arrive),
    duration: 0,
    numberOfTransfers: 0,
    walkDistance: 200,
    legs: [
      leg("WALK", from, `${from} stop`, leave, board),
      leg("BUS", `${from} stop`, `${to} stop`, board, alight, true),
      leg("WALK", `${to} stop`, to, alight, arrive),
    ],
  };
}

type Answer = (vars: {
  origin: { label?: string };
  destination: { label?: string };
  dateTime: Record<string, string>;
}) => OtpItinerary[] | { options?: OtpItinerary[]; errors: { code: string; description: string }[] };

function fakeOtp(answer: Answer) {
  const query = vi.fn(async (_q: string, vars: Record<string, unknown>): Promise<OtpPlanData> => {
    const out = answer(vars as Parameters<Answer>[0]);
    const its = Array.isArray(out) ? out : (out.options ?? []);
    return {
      planConnection: {
        routingErrors: Array.isArray(out) ? [] : out.errors,
        pageInfo: { startCursor: null, endCursor: null, hasNextPage: false, hasPreviousPage: false },
        edges: its.map((node) => ({ node })),
      },
    };
  });
  // OtpClient.query is generic over the response type; these tests only plan.
  return { query: query as unknown as OtpClient["query"] & typeof query };
}

const A = { lat: 25.0478, lon: 121.517, label: "A" };
const V = { lat: 25.056, lon: 121.51, label: "V" };
const W = { lat: 25.06, lon: 121.5, label: "W" };
const B = { lat: 25.1677, lon: 121.4456, label: "B" };
const now = new Date(t("09:00"));

const stayAt = (
  legs: { to: { viaIndex?: number }; end: { scheduled: string } }[],
  next: { start: { scheduled: string } }[],
  via: number,
) => {
  const i = legs.findIndex((l) => l.to.viaIndex === via);
  return (Date.parse(next[i + 1]?.start.scheduled ?? "") - Date.parse(legs[i]?.end.scheduled ?? "")) / 60_000;
};

describe("planWithStops (leaving at a time)", () => {
  // A → V: two options. V → B searched once from the earliest ready time (09:30 + 90 = 11:00).
  const otp = fakeOtp((v) => {
    if (v.origin.label === "A")
      return [
        option("A", "V", "09:05", "09:10", "09:25", "09:30"),
        option("A", "V", "09:20", "09:25", "09:40", "09:45"),
      ];
    expect(v.dateTime).toEqual({ earliestDeparture: t("11:00") });
    return [
      option("V", "B", "11:02", "11:05", "11:50", "11:55"),
      option("V", "B", "11:16", "11:20", "12:00", "12:05"),
      option("V", "B", "11:31", "11:35", "12:20", "12:25"),
    ];
  });

  it("searches each segment once and keeps every stay at least as long as asked", async () => {
    const req = PlanRequest.parse({ from: A, to: B, vias: [{ place: V, dwellMinutes: 90 }] });
    const plan = await planWithStops(req, otp, now);
    expect(otp.query).toHaveBeenCalledTimes(2);
    // 09:05 option arrives 09:30 → ready 11:00 → 11:02; 09:20 option arrives 09:45 → ready 11:15 → 11:16.
    // The list is filled up to five with later departures from the stop (longer stays).
    expect(plan.itineraries.map((it) => [it.start, it.end])).toEqual([
      [t("09:05"), t("11:55")],
      [t("09:05"), t("12:05")],
      [t("09:05"), t("12:25")],
      [t("09:20"), t("12:05")],
      [t("09:20"), t("12:25")],
    ]);
    for (const it of plan.itineraries) {
      expect(stayAt(it.legs, it.legs, 0)).toBeGreaterThanOrEqual(90);
      expect(it.legs.filter((l) => l.to.viaIndex === 0)).toHaveLength(1);
      expect(it.legs.filter((l) => l.from.viaIndex === 0)).toHaveLength(1);
    }
    expect(plan.itineraries[0]?.durationSeconds).toBe((2 * 60 + 50) * 60);
    expect(plan.itineraries[0]?.walkDistanceMeters).toBe(400);
    expect(plan.nextCursor).toBe(`at:${t("09:21")}`);
    expect(plan.errors).toEqual([]);
  });
});

describe("planWithStops (several stops, arriving by, failures)", () => {
  it("chains two stops in order", async () => {
    const otp = fakeOtp((v) => {
      if (v.origin.label === "A") return [option("A", "V", "09:05", "09:10", "09:25", "09:30")];
      if (v.origin.label === "V") return [option("V", "W", "10:00", "10:02", "10:10", "10:12")];
      return [option("W", "B", "10:45", "10:50", "11:20", "11:25")];
    });
    const req = PlanRequest.parse({
      from: A,
      to: B,
      vias: [
        { place: V, dwellMinutes: 30 },
        { place: W, dwellMinutes: 30 },
      ],
    });
    const plan = await planWithStops(req, otp, now);
    expect(otp.query).toHaveBeenCalledTimes(3);
    const it0 = plan.itineraries[0];
    expect(it0?.legs.map((l) => [l.from.viaIndex ?? "-", l.to.viaIndex ?? "-"])).toEqual([
      ["-", "-"],
      ["-", "-"],
      ["-", 0],
      [0, "-"],
      ["-", "-"],
      ["-", 1],
      [1, "-"],
      ["-", "-"],
      ["-", "-"],
    ]);
  });

  it("plans backwards from the arrival time when arriving by", async () => {
    const otp = fakeOtp((v) => {
      if (v.destination.label === "B") {
        expect(v.dateTime).toEqual({ latestArrival: t("13:00") });
        return [option("V", "B", "12:00", "12:05", "12:50", "12:55")];
      }
      // Must arrive at V by 12:00 - 60 = 11:00: take the one leaving last.
      expect(v.dateTime).toEqual({ latestArrival: t("11:00") });
      return [
        option("A", "V", "10:00", "10:05", "10:25", "10:30"),
        option("A", "V", "10:20", "10:25", "10:55", "10:58"),
        option("A", "V", "10:40", "10:45", "11:05", "11:10"),
      ];
    });
    const req = PlanRequest.parse({
      from: A,
      to: B,
      time: t("13:00"),
      arriveBy: true,
      vias: [{ place: V, dwellMinutes: 60 }],
    });
    const plan = await planWithStops(req, otp, now);
    // The one leaving last, plus the earlier departure as a longer stay at V; 10:40 arrives too late.
    expect(plan.itineraries.map((it) => [it.start, it.end])).toEqual([
      [t("10:00"), t("12:55")],
      [t("10:20"), t("12:55")],
    ]);
    expect(plan.previousCursor).toBe(`at:${t("12:54")}`);
  });

  it("drops options that cannot keep the stay and reports routing errors per segment", async () => {
    const otp = fakeOtp((v) =>
      v.origin.label === "A"
        ? [option("A", "V", "09:05", "09:10", "09:25", "09:30")]
        : { errors: [{ code: "NO_TRANSIT_CONNECTION", description: "No transit connection found" }] },
    );
    const plan = await planWithStops(
      PlanRequest.parse({ from: A, to: B, vias: [{ place: V, dwellMinutes: 30 }] }),
      otp,
      now,
    );
    expect(plan.itineraries).toEqual([]);
    expect(plan.errors).toEqual([{ code: "NO_TRANSIT_CONNECTION", message: "Segment 2: No transit connection found" }]);
  });

  it("reports OTP's notes only for a segment that found no way", async () => {
    const note = { code: "WALKING_BETTER_THAN_TRANSIT", description: "trivial distance" };
    const req = PlanRequest.parse({ from: A, to: B, vias: [{ place: V, dwellMinutes: 30 }] });
    const first = [option("A", "V", "09:05", "09:10", "09:25", "09:30")];
    const withWay = fakeOtp((v) =>
      v.origin.label === "A"
        ? first
        : { options: [option("V", "B", "10:05", "10:06", "10:07", "10:08")], errors: [note] },
    );
    expect((await planWithStops(req, withWay, now)).errors).toEqual([]);
    const noWay = fakeOtp((v) => (v.origin.label === "A" ? first : { errors: [note] }));
    expect((await planWithStops(req, noWay, now)).errors.map((e) => e.code)).toEqual(["WALKING_BETTER_THAN_TRANSIT"]);
  });

  it("removes options another one beats on both leaving and arrival time", async () => {
    const otp = fakeOtp((v) =>
      v.origin.label === "A"
        ? [option("A", "V", "09:05", "09:10", "09:25", "09:30"), option("A", "V", "09:10", "09:12", "09:27", "09:31")]
        : [option("V", "B", "10:10", "10:12", "10:40", "10:45")],
    );
    const plan = await planWithStops(
      PlanRequest.parse({ from: A, to: B, vias: [{ place: V, dwellMinutes: 30 }] }),
      otp,
      now,
    );
    // Both reach the same 10:10 departure; leaving at 09:10 is strictly better than at 09:05.
    expect(plan.itineraries.map((it) => it.start)).toEqual([t("09:10")]);
  });

  it("starts from the cursor's time when paging", async () => {
    const otp = fakeOtp((v) => {
      if (v.origin.label === "A") expect(v.dateTime).toEqual({ earliestDeparture: t("09:21") });
      return [];
    });
    await planWithStops(
      PlanRequest.parse({ from: A, to: B, cursor: `at:${t("09:21")}`, vias: [{ place: V, dwellMinutes: 30 }] }),
      otp,
      now,
    );
    expect(cursorTime("at:nonsense")).toBeUndefined();
    expect(cursorTime("next:abc")).toBeUndefined();
  });
});

describe("joinSegments", () => {
  it("marks a one-leg segment between two stops on both ends", () => {
    const seg = (id: string) => ({
      ...mapItinerary(option("X", "Y", "10:00", "10:01", "10:02", "10:03"), id),
      legs: [],
    });
    const walk = mapItinerary(option("V", "W", "10:00", "10:01", "10:02", "10:03"), "w");
    const only = { ...walk, legs: [walk.legs[0] as (typeof walk.legs)[number]] };
    const joined = joinSegments([
      { ...seg("a"), legs: [walk.legs[0] as (typeof walk.legs)[number]] },
      only,
      { ...seg("c"), legs: [walk.legs[2] as (typeof walk.legs)[number]] },
    ]);
    expect(joined.legs[1]?.from.viaIndex).toBe(0);
    expect(joined.legs[1]?.to.viaIndex).toBe(1);
    expect(joined.id).toBe("a+w+c");
  });
});
