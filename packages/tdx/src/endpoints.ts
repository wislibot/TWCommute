import type { TdxClient } from "./client";
import type {
  TdxBikeAvailability,
  TdxBikeStation,
  TdxBusEta,
  TdxBusRoute,
  TdxBusStop,
  TdxTraLiveTrainDelay,
  TdxTraStation,
} from "./types";

/** Cities with public-bike data in TDX (enum from the 公共運輸-自行車 v2 spec). */
export const BIKE_CITIES = [
  "Taipei",
  "NewTaipei",
  "Taoyuan",
  "Hsinchu",
  "HsinchuCounty",
  "MiaoliCounty",
  "Taichung",
  "ChanghuaCounty",
  "YunlinCounty",
  "Chiayi",
  "ChiayiCounty",
  "Tainan",
  "Kaohsiung",
  "PingtungCounty",
  "TaitungCounty",
] as const;
export type BikeCity = (typeof BIKE_CITIES)[number];

/** Cities with city-bus data in TDX (enum from the 公共運輸-公車 v2 spec). */
export const BUS_CITIES = [
  "Taipei",
  "NewTaipei",
  "Taoyuan",
  "Taichung",
  "Tainan",
  "Kaohsiung",
  "Keelung",
  "Hsinchu",
  "HsinchuCounty",
  "MiaoliCounty",
  "ChanghuaCounty",
  "NantouCounty",
  "YunlinCounty",
  "ChiayiCounty",
  "Chiayi",
  "PingtungCounty",
  "YilanCounty",
  "HualienCounty",
  "TaitungCounty",
  "KinmenCounty",
  "PenghuCounty",
  "LienchiangCounty",
] as const;
export type BusCity = (typeof BUS_CITIES)[number];

/** Rail operators with a per-operator GTFS download (Download_03002). */
export const GTFS_RAIL_OPERATORS = ["TRTC"] as const;

const BUS_ETA_FIELDS = [
  "StopUID",
  "RouteUID",
  "SubRouteUID",
  "Direction",
  "EstimateTime",
  "StopStatus",
  "IsLastBus",
  "NextBusTime",
  "PlateNumb",
  "SrcUpdateTime",
  "UpdateTime",
].join(",");

export function getBikeStations(client: TdxClient, city: BikeCity): Promise<TdxBikeStation[]> {
  return client.getJson(`/v2/Bike/Station/City/${city}`);
}

export function getBikeAvailability(client: TdxClient, city: BikeCity): Promise<TdxBikeAvailability[]> {
  return client.getJson(`/v2/Bike/Availability/City/${city}`);
}

/** TDX RouteUIDs (e.g. THB5608): checked before they go into a `$filter`, so nothing needs quoting. */
export const ROUTE_UID_PATTERN = /^[A-Z0-9]+$/;

/** OData `$filter` for these routes: `RouteUID eq 'THB5608' or RouteUID eq 'THB9003'`. */
export function routeUidFilter(routeUids: readonly string[]): string {
  const invalid = routeUids.filter((id) => !ROUTE_UID_PATTERN.test(id));
  if (invalid.length) throw new Error(`Invalid RouteUIDs: ${invalid.join(", ")}`);
  return routeUids.map((id) => `RouteUID eq '${id}'`).join(" or ");
}

/**
 * Batch ETA for a whole city (or all intercity buses). `$select` keeps the payload small;
 * `routeUids` keeps only those routes (a region needs a few dozen of the national InterCity
 * feed's). Without it, or with an empty list, the whole feed is returned.
 */
export function getBusEta(
  client: TdxClient,
  city: BusCity | "InterCity",
  routeUids?: readonly string[],
): Promise<TdxBusEta[]> {
  const path =
    city === "InterCity" ? "/v2/Bus/EstimatedTimeOfArrival/InterCity" : `/v2/Bus/EstimatedTimeOfArrival/City/${city}`;
  const $filter = routeUids?.length ? routeUidFilter(routeUids) : undefined;
  return client.getJson(path, { $select: BUS_ETA_FIELDS, $filter });
}

export function getBusStops(client: TdxClient, city: BusCity | "InterCity"): Promise<TdxBusStop[]> {
  return client.getJson(city === "InterCity" ? "/v2/Bus/Stop/InterCity" : `/v2/Bus/Stop/City/${city}`);
}

export function getBusRoutes(client: TdxClient, city: BusCity | "InterCity"): Promise<TdxBusRoute[]> {
  return client.getJson(city === "InterCity" ? "/v2/Bus/Route/InterCity" : `/v2/Bus/Route/City/${city}`);
}

export function getTraStations(client: TdxClient): Promise<TdxTraStation[]> {
  return client.getJson("/v2/Rail/TRA/Station");
}

export function getTraLiveTrainDelay(client: TdxClient): Promise<TdxTraLiveTrainDelay[]> {
  return client.getJson("/v2/Rail/TRA/LiveTrainDelay");
}

/** National GTFS static bundle (Beta; free while in Beta). */
export function downloadGtfsStatic(client: TdxClient): Promise<Uint8Array> {
  return client.getBinary("/V3/Map/GTFS/Static");
}

export function downloadGtfsStaticRail(
  client: TdxClient,
  operator: (typeof GTFS_RAIL_OPERATORS)[number],
): Promise<Uint8Array> {
  return client.getBinary(`/V3/Map/GTFS/Static/Rail/${operator}`);
}
