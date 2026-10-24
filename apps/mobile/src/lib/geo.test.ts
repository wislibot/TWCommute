import { describe, expect, it } from "vitest";
import { bikeLevel, bikesOutOfService, boundsOf, decodeLine, distanceMeters } from "./geo";
import { legColor, textOn } from "./modes";

describe("geo", () => {
  it("decodes polylines to [lon, lat]", () => {
    expect(decodeLine("_p~iF~ps|U_ulLnnqC")).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
    ]);
  });
  it("computes bounds", () => {
    expect(
      boundsOf([
        [121.5, 25.0],
        [121.6, 25.1],
      ]),
    ).toEqual([121.5, 25.0, 121.6, 25.1]);
    expect(boundsOf([])).toBeNull();
  });
  it("buckets bike availability", () => {
    expect(bikeLevel({ bikes: 0, status: "active" })).toBe("none");
    expect(bikeLevel({ bikes: 2, status: "active" })).toBe("few");
    expect(bikeLevel({ bikes: 9, status: "active" })).toBe("ok");
    expect(bikeLevel({ bikes: 9, status: "suspended" })).toBe("unknown");
  });
  it("measures distances", () => {
    // 新竹 → 竹北 TRA stations: 4.18 km north and 3.83 km east, about 5.7 km apart.
    const d = distanceMeters({ lat: 24.80157, lon: 120.97157 }, { lat: 24.83919, lon: 121.00946 });
    expect(Math.round(d / 100)).toBe(57);
  });
  it("detects YouBike out of service", () => {
    expect(bikesOutOfService([{ status: "closed" }, { status: "suspended" }, { status: "unknown" }])).toBe(true);
    expect(bikesOutOfService([{ status: "closed" }, { status: "active" }])).toBe(false);
    expect(bikesOutOfService([{ status: "unknown" }])).toBe(false);
    expect(bikesOutOfService([])).toBe(false);
  });
});

describe("modes", () => {
  it("prefers valid route colors and picks readable text", () => {
    expect(legColor("SUBWAY", "#E3002C")).toBe("#E3002C");
    expect(legColor("BUS", "bad")).toBe("#16A34A");
    expect(textOn("#FFFF00")).toBe("#000000");
    expect(textOn("#0070BD")).toBe("#FFFFFF");
  });
});
