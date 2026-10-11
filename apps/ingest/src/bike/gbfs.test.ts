import { describe, expect, it } from "vitest";
import { bikeAvailability, bikeStations } from "../test-fixtures";
import { buildGbfsFeed } from "./gbfs";
import { normalizeStation, stripPrefix } from "./normalize";

const avail = new Map(bikeAvailability.map((a) => [a.StationUID, a]));
const stations = bikeStations.map((s) => normalizeStation(s, avail.get(s.StationUID)));
const NOW = 1_791_000_000;

describe("normalizeStation", () => {
  it("strips the YouBike prefix and maps status", () => {
    expect(stations[0]?.name).toEqual({ zh: "捷運科技大樓站", en: "MRT Technology Bldg. Sta." });
    expect(stations[0]?.status).toBe("active");
    expect(stations[1]?.status).toBe("suspended");
    expect(stations[2]?.status).toBe("unknown"); // no availability row
    expect(stations[2]?.bikes).toBeNull();
  });

  it("strips prefix variants", () => {
    expect(stripPrefix("YouBike2.0_台北車站")).toBe("台北車站");
    expect(stripPrefix("YouBike 1.0 - 公館")).toBe("公館");
    expect(stripPrefix("公館")).toBe("公館");
  });
});

describe("buildGbfsFeed", () => {
  it("lists feed urls in gbfs.json", () => {
    const doc = buildGbfsFeed("youbike2", "gbfs", stations, "http://ingest:8081/", NOW) as {
      data: { en: { feeds: { name: string; url: string }[] } };
    };
    expect(doc.data.en.feeds.map((f) => f.url)).toContain("http://ingest:8081/gbfs/youbike2/station_status.json");
  });

  it("keeps systems separate", () => {
    const y2 = buildGbfsFeed("youbike2", "station_information", stations, "x", NOW) as {
      data: { stations: unknown[] };
    };
    const y1 = buildGbfsFeed("youbike1", "station_information", stations, "x", NOW) as {
      data: { stations: unknown[] };
    };
    expect(y2.data.stations).toHaveLength(2);
    expect(y1.data.stations).toHaveLength(1);
  });

  it("maps availability into station_status with e-bike counts", () => {
    const doc = buildGbfsFeed("youbike2", "station_status", stations, "x", NOW) as {
      version: string;
      data: { stations: Array<Record<string, unknown>> };
    };
    expect(doc.version).toBe("2.3");
    const [open, suspended] = doc.data.stations;
    expect(open).toMatchObject({
      station_id: "TPE500101001",
      num_bikes_available: 5,
      num_docks_available: 23,
      is_renting: true,
      is_returning: true,
      vehicle_types_available: [
        { vehicle_type_id: "classic", count: 3 },
        { vehicle_type_id: "ebike", count: 2 },
      ],
      last_reported: Date.parse("2026-10-11T09:00:00+08:00") / 1000,
    });
    expect(suspended).toMatchObject({ is_installed: true, is_renting: false, is_returning: false });
  });
});
