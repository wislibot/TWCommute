import { describe, expect, it } from "vitest";
import { BikeStore } from "./bike/store";
import { BusEtaStore } from "./bus/eta-store";
import { emptyTraIndex } from "./gtfs/tra-index";
import type { State } from "./jobs";
import { HealthRegistry } from "./lib/health";
import { createServer } from "./server";
import { bikeAvailability, bikeStations, busEtas } from "./test-fixtures";

function setup(internalToken?: string) {
  const state: State = {
    bikes: new BikeStore(),
    busEta: new BusEtaStore(),
    traIndex: emptyTraIndex(),
    traTripUpdates: null,
  };
  state.bikes.setStations("Taipei", bikeStations.slice(0, 2));
  state.bikes.setAvailability("Taipei", bikeAvailability);
  state.busEta.replace("Taipei", busEtas);
  const health = new HealthRegistry();
  return { state, app: createServer({ state, health, publicBaseUrl: "http://ingest:8081", internalToken }) };
}

describe("ingest server", () => {
  it("serves GBFS feeds and 404s unknown ones", async () => {
    const { app } = setup();
    const res = await app.inject("/gbfs/youbike2/station_status.json");
    expect(res.statusCode).toBe(200);
    expect(res.json().data.stations).toHaveLength(2);
    expect((await app.inject("/gbfs/youbike2/free_bike_status.json")).statusCode).toBe(404);
    expect((await app.inject("/gbfs/moovo/gbfs.json")).statusCode).toBe(404);
  });

  it("returns 503 for TRA updates until the first poll", async () => {
    const { app, state } = setup();
    expect((await app.inject("/rt/tra-trip-updates.pb")).statusCode).toBe(503);
    state.traTripUpdates = new Uint8Array([1, 2, 3]);
    const res = await app.inject("/rt/tra-trip-updates.pb");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/x-protobuf");
  });

  it("answers bus ETA queries", async () => {
    const { app } = setup();
    const res = await app.inject({
      method: "POST",
      url: "/internal/bus-eta",
      payload: { queries: [{ stopUid: "TPE10001", routeUid: "TPE10307", direction: 0 }, { stopUid: "NOPE" }] },
    });
    expect(res.json().results[0].etaSeconds).toBe(420);
    expect(res.json().results[1]).toBeNull();
  });

  it("finds nearby bikes and validates bbox size", async () => {
    const { app } = setup();
    const near = await app.inject("/internal/bikes/nearby?lat=25.0261&lon=121.5436&radius=200");
    expect(near.json().stations[0].id).toBe("TPE500101001");
    const big = await app.inject("/internal/bikes?minLat=21&minLon=119&maxLat=26&maxLon=122");
    expect(big.statusCode).toBe(400);
  });

  it("protects internal routes when a token is configured", async () => {
    const { app } = setup("s3cret");
    expect((await app.inject("/internal/bus-eta/stop/TPE10001")).statusCode).toBe(401);
    const ok = await app.inject({ url: "/internal/bus-eta/stop/TPE10001", headers: { "x-internal-token": "s3cret" } });
    expect(ok.statusCode).toBe(200);
    // GBFS stays public for OTP.
    expect((await app.inject("/gbfs/youbike2/gbfs.json")).statusCode).toBe(200);
  });
});
