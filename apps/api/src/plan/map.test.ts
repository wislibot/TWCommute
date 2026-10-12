import { describe, expect, it } from "vitest";
import { parseIsoDuration } from "../lib/duration";
import { itineraryWithVia } from "../otp/fixtures";
import { mapItinerary } from "./map";

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
