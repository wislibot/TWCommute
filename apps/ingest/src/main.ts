import { TdxClient } from "@twc/tdx";
import { BikeStore } from "./bike/store";
import { BusEtaStore } from "./bus/eta-store";
import { estimatedCallsPerSecond, loadConfig } from "./config";
import { gtfsPaths, readIfExists } from "./gtfs/files";
import { buildTraIndexFromZip, emptyTraIndex } from "./gtfs/tra-index";
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

  const national = await readIfExists(gtfsPaths(config.DATA_DIR).national);
  if (national) {
    state.traIndex = buildTraIndexFromZip(national.data);
    log.info(
      { trains: state.traIndex.tripIdsByTrainNo.size, stations: state.traIndex.stopIdByStationId.size },
      "loaded TRA index from GTFS",
    );
  } else {
    log.warn("no GTFS bundle found; TRA delays will not be mapped until `pnpm fetch-gtfs` has run");
  }

  const tdx = new TdxClient({
    clientId: config.TDX_CLIENT_ID,
    clientSecret: config.TDX_CLIENT_SECRET,
    ratePerSecond: config.TDX_RATE_PER_SECOND,
  });
  const perSecond = estimatedCallsPerSecond(config);
  log.info(
    { callsPerSecond: perSecond.toFixed(2), callsPerMonth: Math.round(perSecond * 86_400 * 30) },
    "estimated TDX usage",
  );

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
