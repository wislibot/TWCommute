import type { TdxClient } from "./client";
import type { TdxBikeAvailability, TdxBikeStation, TdxBusEta, TdxTraLiveTrainDelay } from "./types";

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

/** Batch ETA for a whole city (or all intercity buses). `$select` keeps the payload small. */
export function getBusEta(client: TdxClient, city: BusCity | "InterCity"): Promise<TdxBusEta[]> {
  const path =
    city === "InterCity" ? "/v2/Bus/EstimatedTimeOfArrival/InterCity" : `/v2/Bus/EstimatedTimeOfArrival/City/${city}`;
  return client.getJson(path, { $select: BUS_ETA_FIELDS });
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
