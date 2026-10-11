/**
 * Small synthetic TDX-shaped rows for unit tests. Field names follow the TDX OpenAPI specs;
 * values are made up and are not real station data.
 */
import type { TdxBikeAvailability, TdxBikeStation, TdxBusEta } from "@twc/tdx";

export const bikeStations: TdxBikeStation[] = [
  {
    StationUID: "TPE500101001",
    StationID: "500101001",
    StationName: { Zh_tw: "YouBike2.0_捷運科技大樓站", En: "YouBike2.0_MRT Technology Bldg. Sta." },
    StationPosition: { PositionLon: 121.5436, PositionLat: 25.0261 },
    BikesCapacity: 28,
    ServiceType: 2,
  },
  {
    StationUID: "TPE500101002",
    StationID: "500101002",
    StationName: { Zh_tw: "YouBike2.0_復興南路二段273號前", En: "YouBike2.0_No.273, Sec. 2, Fuxing S. Rd." },
    StationPosition: { PositionLon: 121.5434, PositionLat: 25.0256 },
    BikesCapacity: 21,
    ServiceType: 2,
  },
  {
    StationUID: "TXG1001",
    StationID: "1001",
    StationName: { Zh_tw: "YouBike1.0_測試站" },
    StationPosition: { PositionLon: 120.68, PositionLat: 24.14 },
    BikesCapacity: 30,
    ServiceType: 1,
  },
];

export const bikeAvailability: TdxBikeAvailability[] = [
  {
    StationUID: "TPE500101001",
    StationID: "500101001",
    ServiceStatus: 1,
    ServiceType: 2,
    AvailableRentBikes: 5,
    AvailableReturnBikes: 23,
    AvailableRentBikesDetail: { GeneralBikes: 3, ElectricBikes: 2 },
    SrcUpdateTime: "2026-10-11T09:00:00+08:00",
  },
  {
    StationUID: "TPE500101002",
    StationID: "500101002",
    ServiceStatus: 2,
    ServiceType: 2,
    AvailableRentBikes: 0,
    AvailableReturnBikes: 21,
    SrcUpdateTime: "2026-10-11T09:00:00+08:00",
  },
];

export const busEtas: TdxBusEta[] = [
  {
    StopUID: "TPE10001",
    RouteUID: "TPE10307",
    SubRouteUID: "TPE103070",
    Direction: 0,
    EstimateTime: 420,
    StopStatus: 0,
  },
  {
    StopUID: "TPE10001",
    RouteUID: "TPE10307",
    SubRouteUID: "TPE103071",
    Direction: 1,
    EstimateTime: 90,
    StopStatus: 0,
  },
  { StopUID: "TPE10001", RouteUID: "TPE10235", Direction: 0, EstimateTime: null, StopStatus: 3, IsLastBus: false },
];
