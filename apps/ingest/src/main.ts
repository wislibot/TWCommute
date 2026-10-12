import { TdxClient } from "@twc/tdx";
import { BikeStore } from "./bike/store";
import { BusEtaStore } from "./bus/eta-store";
import { estimatedCallsPerMinute, loadConfig } from "./config";
import { gtfsPaths, readIfExists } from "./gtfs/files";
import { loadGtfsIndexes } from "./gtfs/indexes";
import { emptyTraIndex } from "./gtfs/tra-index";
import { buildJobs, type State } from "./jobs";
import { HealthRegistry } from "./lib/health";
import { Scheduler } from "./lib/scheduler";
import { createServer } from "./server";

async function main() {
  const config = loadConfig();
  const health = new HealthRegistry();
  const state: State = {
    bikes: new BikeStore(),
    busEta: new BusEtaStore(),
    traIndex: emptyTraIndex(),
    traTripUpdates: null,
  };
  const app = createServer({
    state,
    health,
    publicBaseUrl: config.PUBLIC_BASE_URL,
    internalToken: config.INTERNAL_TOKEN,
    logger: true,
  });
  const log = app.log;

  const national = await readIfExists(config.GTFS_INDEX_PATH ?? gtfsPaths(config.DATA_DIR).national);
  if (national) {
    const indexes = loadGtfsIndexes(national.data);
    state.traIndex = indexes.tra;
    state.busEta.setStopRoutes(indexes.busStopRoutes);
    log.info(
      {
        trains: state.traIndex.tripIdsByTrainNo.size,
        stations: state.traIndex.stopIdByStationId.size,
        tripsWithStops: state.traIndex.stopsByTripId.size,
        busStops: indexes.busStopRoutes.size,
      },
      "loaded TRA and bus stop indexes from GTFS",
    );
  } else {
    log.warn("no GTFS bundle found; TRA delays will not be mapped until `pnpm fetch-gtfs` has run");
  }

  const tdx = new TdxClient({
    clientId: config.TDX_CLIENT_ID,
    clientSecret: config.TDX_CLIENT_SECRET,
    ratePerMinute: config.TDX_RATE_PER_MINUTE,
  });
  const perMinute = estimatedCallsPerMinute(config);
  log.info(
    { callsPerMinute: perMinute.toFixed(1), allowedPerMinute: config.TDX_RATE_PER_MINUTE },
    "estimated TDX usage",
  );
  if (perMinute > config.TDX_RATE_PER_MINUTE) {
    log.warn(
      { callsPerMinute: perMinute.toFixed(1), allowedPerMinute: config.TDX_RATE_PER_MINUTE },
      "polling needs more TDX requests than the plan allows; data will lag. Reduce cities/intervals or upgrade the TDX plan",
    );
  }

  const scheduler = new Scheduler(health, log);
  for (const { job, delayMs } of buildJobs(config, tdx, state, log)) scheduler.add(job, delayMs);

  const shutdown = async () => {
    scheduler.stop();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await app.listen({ host: config.HOST, port: config.PORT });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
