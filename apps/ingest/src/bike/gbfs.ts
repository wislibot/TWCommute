import type { BikeServiceType, BikeStation } from "@twc/contracts";

/**
 * YouBike data in TDX is not GBFS, but OpenTripPlanner's vehicle-rental updater reads GBFS.
 * We publish one GBFS 2.3 system per docked service type so OTP never routes a YouBike 2.0
 * bike into a 1.0 dock. Moovo (e-fence, no docks) is not published.
 */
export const GBFS_SYSTEMS = {
  youbike2: { serviceType: "youbike2", name: "YouBike 2.0" },
  youbike1: { serviceType: "youbike1", name: "YouBike 1.0" },
} as const satisfies Record<string, { serviceType: BikeServiceType; name: string }>;
export type GbfsSystemId = keyof typeof GBFS_SYSTEMS;

export const GBFS_FEEDS = ["system_information", "vehicle_types", "station_information", "station_status"] as const;
export type GbfsFeed = (typeof GBFS_FEEDS)[number];

const VERSION = "2.3";
const TTL_SECONDS = 60;
const CLASSIC = "classic";
const EBIKE = "ebike";

export function isGbfsSystem(id: string): id is GbfsSystemId {
  return Object.hasOwn(GBFS_SYSTEMS, id);
}

interface Envelope<T> {
  last_updated: number;
  ttl: number;
  version: string;
  data: T;
}

function envelope<T>(data: T, nowSeconds: number): Envelope<T> {
  return { last_updated: nowSeconds, ttl: TTL_SECONDS, version: VERSION, data };
}

export function buildGbfsFeed(
  system: GbfsSystemId,
  feed: GbfsFeed | "gbfs",
  stations: BikeStation[],
  baseUrl: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Envelope<unknown> {
  const own = stations.filter((s) => s.serviceType === GBFS_SYSTEMS[system].serviceType);
  const root = `${baseUrl.replace(/\/$/, "")}/gbfs/${system}`;
  switch (feed) {
    case "gbfs":
      return envelope({ en: { feeds: GBFS_FEEDS.map((name) => ({ name, url: `${root}/${name}.json` })) } }, nowSeconds);
    case "system_information":
      return envelope(
        {
          system_id: system,
          language: "zh-TW",
          name: GBFS_SYSTEMS[system].name,
          timezone: "Asia/Taipei",
          operator: "YouBike Co., Ltd. (資料來源：交通部運輸資料流通服務平臺)",
        },
        nowSeconds,
      );
    case "vehicle_types":
      return envelope(
        {
          vehicle_types: [
            { vehicle_type_id: CLASSIC, form_factor: "bicycle", propulsion_type: "human", name: "YouBike" },
            // GBFS requires a range for motorized types; this is a conservative nominal value.
            {
              vehicle_type_id: EBIKE,
              form_factor: "bicycle",
              propulsion_type: "electric_assist",
              max_range_meters: 20_000,
              name: "YouBike 2.0E",
            },
          ],
        },
        nowSeconds,
      );
    case "station_information":
      return envelope(
        {
          stations: own.map((s) => ({
            station_id: s.id,
            name: s.name.zh,
            lat: s.lat,
            lon: s.lon,
            ...(s.capacity !== null ? { capacity: s.capacity } : {}),
          })),
        },
        nowSeconds,
      );
    case "station_status":
      return envelope({ stations: own.map((s) => stationStatus(s, nowSeconds)) }, nowSeconds);
  }
}

function stationStatus(s: BikeStation, nowSeconds: number) {
  const bikes = s.bikes ?? 0;
  const ebikes = Math.min(s.ebikes ?? 0, bikes);
  const active = s.status === "active";
  const lastReported = s.updatedAt ? Math.floor(Date.parse(s.updatedAt) / 1000) : nowSeconds;
  return {
    station_id: s.id,
    num_bikes_available: bikes,
    vehicle_types_available: [
      { vehicle_type_id: CLASSIC, count: bikes - ebikes },
      { vehicle_type_id: EBIKE, count: ebikes },
    ],
    num_docks_available: s.docks ?? 0,
    is_installed: s.status !== "closed",
    is_renting: active,
    is_returning: active,
    last_reported: Number.isFinite(lastReported) ? lastReported : nowSeconds,
  };
}
