import type { Leg } from "@twc/contracts";
import { describe, expect, it } from "vitest";
import { parseIsoDuration } from "../lib/duration";
import { itineraryWithVia } from "../otp/fixtures";
import { mapItinerary, shiftIso, shiftViaDepartures } from "./map";

describe("mapItinerary", () => {
  const it0 = mapItinerary(itineraryWithVia, "x-0");

  it("maps modes, routes and realtime flags", () => {
    expect(it0.legs.map((l) => l.mode)).toEqual(["BICYCLE", "SUBWAY", "WALK", "WALK", "BUS"]);
    const mrt = it0.legs[1];
    expect(mrt?.route).toMatchObject({
      id: "trtc:R",
      shortName: "淡水信義線",
      color: "#E3002C",
      agencyName: "臺北捷運",
    });
    expect(mrt?.realtime).toBe("live");
    expect(mrt?.start).toMatchObject({ estimated: "2026-10-11T09:10:00+08:00", delaySeconds: 60 });
    expect(it0.legs[4]?.realtime).toBe("scheduled");
  });

  it("numbers the via visit on arrival and departure legs", () => {
    expect(it0.legs[2]?.to.viaIndex).toBe(0);
    expect(it0.legs[3]?.from.viaIndex).toBe(0);
    expect(it0.legs[4]?.from.viaIndex).toBeUndefined();
  });

  it("exposes rental stations with availability", () => {
    expect(it0.legs[0]?.rentedBike).toBe(true);
    expect(it0.legs[0]?.from.bikeStation).toMatchObject({ stationId: "youbike2:TPE500101001", bikesAvailable: 2 });
    expect(it0.legs[0]?.to.bikeStation).toMatchObject({ docksAvailable: 0 });
  });
});

describe("parseIsoDuration", () => {
  it("parses common forms", () => {
    expect(parseIsoDuration("PT1M30S")).toBe(90);
    expect(parseIsoDuration("-PT2M")).toBe(-120);
    expect(parseIsoDuration("P1DT1H")).toBe(90000);
    expect(parseIsoDuration("nope")).toBeUndefined();
  });
});

describe("via stays", () => {
  // Same fixture, but the bus after the via leaves 20 minutes later than the walk back reaches the stop.
  const late = structuredClone(itineraryWithVia);
  const bus = late.legs[4];
  if (bus) bus.start = { scheduledTime: "2026-10-11T11:30:00+08:00", estimated: null };

  it("moves the walk back from a via next to the departure, keeping a buffer", () => {
    const legs = mapItinerary(late, "x").legs;
    expect(legs[3]?.start.scheduled).toBe("2026-10-11T11:25:00+08:00");
    expect(legs[3]?.end.scheduled).toBe("2026-10-11T11:28:00+08:00");
    // The stay at the via is now arrival → shifted departure.
    expect(legs[2]?.end.scheduled).toBe("2026-10-11T09:35:00+08:00");
  });

  it("leaves legs alone when there is no slack beyond the buffer", () => {
    const legs = mapItinerary(itineraryWithVia, "x").legs;
    expect(legs[3]?.start.scheduled).toBe("2026-10-11T11:05:00+08:00");
  });

  it("shifts ISO times keeping the offset", () => {
    expect(shiftIso("2026-10-11T23:50:00+08:00", 20 * 60_000)).toBe("2026-10-12T00:10:00+08:00");
    expect(shiftIso("2026-10-11T10:00:00Z", 60_000)).toBe("2026-10-11T10:01:00.000Z");
  });
});

describe("via stays with requested dwell times", () => {
  /** Minimal synthetic legs shaped like OTP 2.10 output (street legs leave a via immediately). */
  const t = (hhmm: string) => `2026-10-11T${hhmm}:00+08:00`;
  const leg = (
    mode: Leg["mode"],
    start: string,
    end: string,
    via: { from?: number; to?: number } = {},
    est?: { start?: string; end?: string },
  ): Leg => ({
    mode,
    from: { name: "a", lat: 25, lon: 121.5, ...(via.from !== undefined ? { viaIndex: via.from } : {}) },
    to: { name: "b", lat: 25, lon: 121.5, ...(via.to !== undefined ? { viaIndex: via.to } : {}) },
    start: { scheduled: t(start), ...(est?.start ? { estimated: t(est.start) } : {}) },
    end: { scheduled: t(end), ...(est?.end ? { estimated: t(est.end) } : {}) },
    durationSeconds: 0,
    distanceMeters: 0,
    realtime: "scheduled",
    rentedBike: false,
  });
  const stay = (legs: Leg[], arrive: number) =>
    (Date.parse(legs[arrive + 1]?.start.scheduled ?? "") - Date.parse(legs[arrive]?.end.scheduled ?? "")) / 60_000;

  it("gives every via in one street chain its own dwell (stop via, then a coordinate via)", () => {
    const legs = shiftViaDepartures(
      [
        leg("BUS", "08:40", "09:00", { to: 0 }),
        leg("WALK", "09:00", "09:05", { from: 0, to: 1 }),
        leg("WALK", "09:05", "09:10", { from: 1 }),
        leg("BUS", "10:40", "11:00"),
      ],
      [60, 30],
    );
    expect(stay(legs, 0)).toBe(60);
    expect(stay(legs, 1)).toBe(30);
    expect(legs[2]?.end.scheduled).toBe(t("10:40"));
  });

  it("never shortens the stay below the dwell to make room for the boarding buffer", () => {
    const legs = shiftViaDepartures(
      [
        leg("WALK", "09:00", "09:35", { to: 0 }),
        leg("WALK", "09:35", "09:38", { from: 0 }),
        leg("BUS", "11:09", "11:30"),
      ],
      [90],
    );
    expect(stay(legs, 0)).toBe(90);
    expect(legs[1]?.end.scheduled).toBe(t("11:08"));
  });

  it("uses the vehicle's live departure, not its timetable", () => {
    const legs = shiftViaDepartures(
      [
        leg("WALK", "09:00", "09:35", { to: 0 }),
        leg("WALK", "09:35", "09:40", { from: 0 }),
        leg("RAIL", "11:00", "11:30", {}, { start: "11:15" }),
      ],
      [90],
    );
    // Leftover after the 90 min dwell goes to the via, keeping the 2-minute buffer before 11:15.
    expect(legs[1]?.start.scheduled).toBe(t("11:08"));
    expect(legs[1]?.end.scheduled).toBe(t("11:13"));
  });

  it("leaves a via whose next leg is the vehicle itself untouched", () => {
    const input = [leg("BUS", "08:40", "09:00", { to: 0 }), leg("BUS", "10:00", "10:30", { from: 0 })];
    expect(shiftViaDepartures(input, [60])).toEqual(input);
  });
});
