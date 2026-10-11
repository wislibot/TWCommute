/**
 * Subset of TDX DTOs used by TWCommute. Field names and enums follow the TDX OpenAPI specs
 * (https://tdx.transportdata.tw/webapi/File/Swagger/V3/{groupId}).
 */

export interface TdxName {
  Zh_tw?: string;
  En?: string;
  Ja?: string;
  Ko?: string;
}

export interface TdxPoint {
  PositionLon: number;
  PositionLat: number;
  GeoHash?: string;
}

/** ServiceType: 1 = YouBike 1.0, 2 = YouBike 2.0, 3 = Moovo (e-fence, no docks). */
export type TdxBikeServiceType = 1 | 2 | 3;

export interface TdxBikeStation {
  StationUID: string;
  StationID: string;
  AuthorityID?: string;
  StationName: TdxName;
  StationPosition: TdxPoint;
  StationAddress?: TdxName;
  BikesCapacity?: number;
  ServiceType: TdxBikeServiceType;
  SrcUpdateTime?: string;
  UpdateTime?: string;
}

/** ServiceStatus: 0 = stopped, 1 = normal, 2 = suspended. */
export interface TdxBikeAvailability {
  StationUID: string;
  StationID: string;
  ServiceStatus: 0 | 1 | 2;
  ServiceType: TdxBikeServiceType;
  AvailableRentBikes: number;
  /** Not provided for Moovo (no docks). */
  AvailableReturnBikes?: number;
  AvailableRentBikesDetail?: { GeneralBikes?: number; ElectricBikes?: number };
  SrcUpdateTime?: string;
  UpdateTime?: string;
}

/**
 * Bus estimated time of arrival (N1).
 * StopStatus: 0 normal, 1 not departed yet, 2 not stopping (traffic control), 3 last bus passed, 4 not operating today.
 * EstimateTime is seconds, null when StopStatus is 2–4.
 */
export interface TdxBusEta {
  PlateNumb?: string;
  StopUID: string;
  StopID?: string;
  StopName?: TdxName;
  RouteUID: string;
  RouteID?: string;
  RouteName?: TdxName;
  SubRouteUID?: string;
  SubRouteID?: string;
  Direction: number;
  EstimateTime?: number | null;
  StopStatus?: 0 | 1 | 2 | 3 | 4;
  IsLastBus?: boolean;
  NextBusTime?: string;
  SrcUpdateTime?: string;
  UpdateTime?: string;
}

/** TRA live delay: DelayTime is minutes (0 = on time) as of the last station passed. */
export interface TdxTraLiveTrainDelay {
  TrainNo: string;
  StationID: string;
  StationName?: TdxName;
  DelayTime: number;
  SrcUpdateTime?: string;
  UpdateTime?: string;
}

/** Bus stop (static). `City` / `LocationCityCode` give the stop's city directly. */
export interface TdxBusStop {
  StopUID: string;
  StopID: string;
  AuthorityID?: string;
  StopName: TdxName;
  StopPosition: TdxPoint;
  StationID?: string;
  City?: string;
  CityCode?: string;
  LocationCityCode?: string;
}

export interface TdxBusSubRoute {
  SubRouteUID: string;
  SubRouteID: string;
  SubRouteName?: TdxName;
  Direction?: number;
  Headsign?: string;
}

/** Bus route (static). A route has one or more sub-routes (variants/directions). */
export interface TdxBusRoute {
  RouteUID: string;
  RouteID: string;
  RouteName: TdxName;
  SubRoutes?: TdxBusSubRoute[];
  BusRouteType?: number;
  City?: string;
  CityCode?: string;
}

/** TRA station (static), including the city it is located in. */
export interface TdxTraStation {
  StationUID: string;
  StationID: string;
  StationName: TdxName;
  StationPosition: TdxPoint;
  LocationCity?: string;
  LocationCityCode?: string;
}
