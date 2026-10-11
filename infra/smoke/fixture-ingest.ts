/**
 * Ingest server with synthetic YouBike state (no TDX), for the smoke test.
 *   tsx infra/smoke/fixture-ingest.ts <port>
 */
import type { TdxBikeAvailability, TdxBikeStation } from "@twc/tdx";
import { BikeStore } from "../../apps/ingest/src/bike/store";
import { BusEtaStore } from "../../apps/ingest/src/bus/eta-store";
import { emptyTraIndex } from "../../apps/ingest/src/gtfs/tra-index";
import { HealthRegistry } from "../../apps/ingest/src/lib/health";
import { createServer } from "../../apps/ingest/src/server";

const port = Number(process.argv[2] ?? 8091);
const now = new Date().toISOString();
const station = (uid: string, name: string, lat: number, lon: number): TdxBikeStation => ({
  StationUID: uid,
  StationID: uid.slice(3),
  StationName: { Zh_tw: `YouBike2.0_${name}`, En: `YouBike2.0_${name}` },
  StationPosition: { PositionLat: lat, PositionLon: lon },
  BikesCapacity: 20,
  ServiceType: 2,
});
const avail = (uid: string, bikes: number, docks: number): TdxBikeAvailability => ({
  StationUID: uid,
  StationID: uid.slice(3),
  ServiceStatus: 1,
  ServiceType: 2,
  AvailableRentBikes: bikes,
  AvailableReturnBikes: docks,
  AvailableRentBikesDetail: { GeneralBikes: bikes - 1, ElectricBikes: 1 },
  SrcUpdateTime: now,
});

const bikes = new BikeStore();
bikes.setStations("Taipei", [
  station("TPE900001", "起點站", 25.0302, 121.5004),
  station("TPE900002", "終點站", 25.0498, 121.5196),
]);
bikes.setAvailability("Taipei", [avail("TPE900001", 2, 18), avail("TPE900002", 15, 0)]);
const busEta = new BusEtaStore();
busEta.replace("Taipei", [
  {
    StopUID: "TPE10002",
    RouteUID: "TPE10307",
    SubRouteUID: "TPE103070",
    Direction: 0,
    EstimateTime: 300,
    StopStatus: 0,
    SrcUpdateTime: now,
  },
  {
    StopUID: "TPE10002",
    RouteUID: "TPE10307",
    SubRouteUID: "TPE103070",
    Direction: 1,
    EstimateTime: 60,
    StopStatus: 0,
    SrcUpdateTime: now,
  },
]);

const app = createServer({
  state: { bikes, busEta, traIndex: emptyTraIndex(), traTripUpdates: null },
  health: new HealthRegistry(),
  publicBaseUrl: `http://127.0.0.1:${port}`,
});
await app.listen({ host: "127.0.0.1", port });
console.log(`fixture ingest on :${port}`);
