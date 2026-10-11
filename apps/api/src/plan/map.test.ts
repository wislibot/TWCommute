import { describe, expect, it } from "vitest";
import { parseIsoDuration } from "../lib/duration";
import { itineraryWithVia } from "../otp/fixtures";
import { mapItinerary, shiftIso } from "./map";

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
