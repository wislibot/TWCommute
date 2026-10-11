import { describe, expect, it } from "vitest";
import { formatDistance, formatTime, minutesBetween, minutesUntil, splitDuration } from "./format";

describe("format", () => {
  it("shows Taipei time", () => {
    expect(formatTime("2026-10-11T01:05:00Z", "en")).toBe("09:05");
    expect(formatTime("nope", "en")).toBe("--:--");
  });
  it("rounds minutes up for arrivals", () => {
    expect(minutesUntil(30)).toBe(1);
    expect(minutesUntil(0)).toBe(0);
    expect(minutesUntil(-10)).toBe(0);
  });
  it("splits durations and formats distance", () => {
    expect(splitDuration(5100)).toEqual({ hours: 1, minutes: 25 });
    expect(formatDistance(234)).toBe("230 m");
    expect(formatDistance(1530)).toBe("1.5 km");
    expect(minutesBetween("2026-10-11T09:35:00+08:00", "2026-10-11T11:05:00+08:00")).toBe(90);
  });
});
