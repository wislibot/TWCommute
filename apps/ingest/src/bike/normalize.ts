import type { BikeServiceType, BikeStation } from "@twc/contracts";
import type { TdxBikeAvailability, TdxBikeStation } from "@twc/tdx";

const SERVICE_TYPES: Record<number, BikeServiceType> = { 1: "youbike1", 2: "youbike2", 3: "moovo" };

/** Merge TDX static station data with the latest availability into our BikeStation shape. */
export function normalizeStation(station: TdxBikeStation, availability: TdxBikeAvailability | undefined): BikeStation {
  const serviceType = SERVICE_TYPES[station.ServiceType] ?? "youbike2";
  const ebikes = availability?.AvailableRentBikesDetail?.ElectricBikes ?? null;
  return {
    id: station.StationUID,
    name: {
      zh: stripPrefix(station.StationName.Zh_tw ?? station.StationID),
      en: station.StationName.En ? stripPrefix(station.StationName.En) : undefined,
    },
    lat: station.StationPosition.PositionLat,
    lon: station.StationPosition.PositionLon,
    serviceType,
    capacity: station.BikesCapacity ?? null,
    bikes: availability ? availability.AvailableRentBikes : null,
    ebikes: availability ? ebikes : null,
    docks: availability && serviceType !== "moovo" ? (availability.AvailableReturnBikes ?? null) : null,
    status: availability ? statusOf(availability.ServiceStatus) : "unknown",
    updatedAt: availability?.SrcUpdateTime ?? availability?.UpdateTime ?? null,
  };
}

function statusOf(s: number): BikeStation["status"] {
  if (s === 1) return "active";
  if (s === 2) return "suspended";
  if (s === 0) return "closed";
  return "unknown";
}

/** YouBike names carry a system prefix such as "YouBike2.0_" that is noise in the UI. */
export function stripPrefix(name: string): string {
  return name.replace(/^YouBike\s*\d(\.\d)?\s*[_＿-]\s*/i, "").trim();
}
