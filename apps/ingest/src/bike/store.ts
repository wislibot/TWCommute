import type { BBox, BikeStation } from "@twc/contracts";
import type { TdxBikeAvailability, TdxBikeStation } from "@twc/tdx";
import { distanceMeters } from "../lib/geo";
import { normalizeStation } from "./normalize";

/** Latest YouBike state per city, kept in memory (a few thousand stations nationwide). */
export class BikeStore {
  private stations = new Map<string, TdxBikeStation[]>();
  private availability = new Map<string, Map<string, TdxBikeAvailability>>();
  private merged: BikeStation[] = [];

  setStations(city: string, stations: TdxBikeStation[]): void {
    this.stations.set(city, stations);
    this.rebuild();
  }

  setAvailability(city: string, rows: TdxBikeAvailability[]): void {
    this.availability.set(city, new Map(rows.map((r) => [r.StationUID, r])));
    this.rebuild();
  }

  hasStations(city: string): boolean {
    return (this.stations.get(city)?.length ?? 0) > 0;
  }

  all(): BikeStation[] {
    return this.merged;
  }

  inBBox(b: BBox): BikeStation[] {
    return this.merged.filter((s) => s.lat >= b.minLat && s.lat <= b.maxLat && s.lon >= b.minLon && s.lon <= b.maxLon);
  }

  nearby(lat: number, lon: number, radiusMeters: number, limit = 20): Array<BikeStation & { distanceMeters: number }> {
    return this.merged
      .map((s) => ({ ...s, distanceMeters: distanceMeters(lat, lon, s.lat, s.lon) }))
      .filter((s) => s.distanceMeters <= radiusMeters)
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, limit);
  }

  private rebuild(): void {
    const out: BikeStation[] = [];
    for (const [city, stations] of this.stations) {
      const avail = this.availability.get(city);
      for (const st of stations) out.push(normalizeStation(st, avail?.get(st.StationUID)));
    }
    this.merged = out;
  }
}
