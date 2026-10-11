import polyline from "@mapbox/polyline";
import type { BikeStation, Itinerary } from "@twc/contracts";
import { legColor } from "./modes";

type LngLat = [number, number];
type Bounds = [west: number, south: number, east: number, north: number];

/** OTP encodes leg shapes as Google polylines (precision 5) in [lat, lon] order. */
export function decodeLine(encoded: string): LngLat[] {
  return polyline.decode(encoded, 5).map(([lat, lon]) => [lon, lat]);
}

export function itineraryGeoJson(it: Itinerary): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type: "FeatureCollection",
    features: it.legs.map((leg, i) => ({
      type: "Feature",
      id: i,
      properties: { mode: leg.mode, color: legColor(leg.mode, leg.route?.color), dashed: leg.mode === "WALK" },
      geometry: {
        type: "LineString",
        coordinates: leg.geometry
          ? decodeLine(leg.geometry)
          : [
              [leg.from.lon, leg.from.lat],
              [leg.to.lon, leg.to.lat],
            ],
      },
    })),
  };
}

export function boundsOf(points: LngLat[]): Bounds | null {
  if (points.length === 0) return null;
  let [west, south, east, north] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [lon, lat] of points) {
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return [west, south, east, north];
}

/** Bike availability bucket drives the station dot color on the map. */
export function bikeLevel(s: Pick<BikeStation, "bikes" | "status">): "none" | "few" | "ok" | "unknown" {
  if (s.status !== "active" || s.bikes === null) return "unknown";
  if (s.bikes === 0) return "none";
  return s.bikes < 3 ? "few" : "ok";
}

export function bikesGeoJson(stations: BikeStation[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: stations.map((s) => ({
      type: "Feature",
      id: s.id,
      properties: { id: s.id, level: bikeLevel(s), bikes: s.bikes ?? -1, docks: s.docks ?? -1 },
      geometry: { type: "Point", coordinates: [s.lon, s.lat] },
    })),
  };
}
