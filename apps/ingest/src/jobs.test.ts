import { TDX_AUTH_URL, TdxClient } from "@twc/tdx";
import { describe, expect, it, vi } from "vitest";
import { BikeStore } from "./bike/store";
import { BusEtaStore } from "./bus/eta-store";
import { loadConfig } from "./config";
import type { BusStopRoutes } from "./gtfs/indexes";
import { emptyTraIndex } from "./gtfs/tra-index";
import { buildJobs, resolveIntercityRoutes, type State } from "./jobs";

const creds = { TDX_CLIENT_ID: "id", TDX_CLIENT_SECRET: "secret" };
const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const at = { first: 1, last: 1 };
const hsinchuStops: BusStopRoutes = new Map([
  [
    "THB100903",
    new Map([
      ["THB560801|0", at],
      ["HSZ000101|0", at],
    ]),
  ],
]);

describe("resolveIntercityRoutes", () => {
  it("polls the whole feed for '' and the given routes for a list", () => {
    const log = logger();
    expect(resolveIntercityRoutes([], hsinchuStops, log)).toBeUndefined();
    expect(resolveIntercityRoutes(["THB9003"], hsinchuStops, log)).toEqual(["THB9003"]);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("takes 'auto' from the GTFS index, else falls back to the whole feed with a warning", () => {
    const log = logger();
    expect(resolveIntercityRoutes("auto", hsinchuStops, log)).toEqual(["THB5608"]);
    expect(log.warn).not.toHaveBeenCalled();
    expect(resolveIntercityRoutes("auto", null, log)).toBeUndefined();
    expect(resolveIntercityRoutes("auto", new Map(), log)).toBeUndefined();
    expect(log.warn).toHaveBeenCalledTimes(2);
  });
});

describe("buildJobs", () => {
  it("filters only the InterCity ETA poll by route, keeping the job names", async () => {
    const urls: string[] = [];
    const fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      return Response.json(url === TDX_AUTH_URL ? { access_token: "t", expires_in: 86_400 } : []);
    }) as typeof globalThis.fetch;
    const tdx = new TdxClient({ clientId: "id", clientSecret: "secret", fetch, ratePerMinute: 1000 });
    const state: State = {
      bikes: new BikeStore(),
      busEta: new BusEtaStore(),
      traIndex: emptyTraIndex(),
      traTripUpdates: null,
    };
    const config = loadConfig({ ...creds, BUS_CITIES: "Hsinchu", BIKE_CITIES: "", BUS_INTERCITY: "true" });
    const jobs = buildJobs(config, tdx, state, logger(), ["THB5608", "THB9003"]).map((j) => j.job);
    expect(jobs.map((j) => j.name)).toEqual([
      "bus-routes:Hsinchu",
      "bus-eta:Hsinchu",
      "bus-routes:InterCity",
      "bus-eta:InterCity",
      "tra-delay",
    ]);
    for (const job of jobs.filter((j) => j.name.startsWith("bus-"))) await job.run();
    const filters = Object.fromEntries(
      urls.filter((u) => u !== TDX_AUTH_URL).map((u) => [new URL(u).pathname, new URL(u).searchParams.get("$filter")]),
    );
    expect(filters).toEqual({
      "/api/basic/v2/Bus/Route/City/Hsinchu": null,
      "/api/basic/v2/Bus/EstimatedTimeOfArrival/City/Hsinchu": null,
      "/api/basic/v2/Bus/Route/InterCity": null,
      "/api/basic/v2/Bus/EstimatedTimeOfArrival/InterCity": "RouteUID eq 'THB5608' or RouteUID eq 'THB9003'",
    });
  });
});
