import { BBox } from "@twc/contracts";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { buildGbfsFeed, GBFS_FEEDS, type GbfsFeed, isGbfsSystem } from "./bike/gbfs";
import type { State } from "./jobs";
import type { HealthRegistry } from "./lib/health";

export interface ServerDeps {
  state: State;
  health: HealthRegistry;
  publicBaseUrl: string;
  internalToken?: string;
  logger?: boolean;
}

const EtaRequest = z.object({
  queries: z
    .array(
      z.object({
        stopUid: z.string().min(1),
        routeUid: z.string().optional(),
        subRouteUid: z.string().optional(),
        direction: z.number().int().optional(),
        toStopUid: z.string().min(1).optional(),
      }),
    )
    .max(50),
});

const NearbyQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().positive().max(2000).default(500),
  limit: z.coerce.number().int().positive().max(50).default(10),
});

export function createServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false });
  const { state, health } = deps;

  app.get("/health", async () => {
    const feeds = health.snapshot();
    return { status: feeds.every((f) => f.healthy) ? "ok" : "degraded", feeds, busLive: state.busEta.liveCounts() };
  });

  // GBFS for OpenTripPlanner's vehicle-rental updater.
  app.get<{ Params: { system: string; file: string } }>("/gbfs/:system/:file", async (req, reply) => {
    const { system, file } = req.params;
    const feed = file.replace(/\.json$/, "");
    if (!isGbfsSystem(system) || !(feed === "gbfs" || (GBFS_FEEDS as readonly string[]).includes(feed))) {
      return reply.code(404).send({ error: "not_found" });
    }
    return buildGbfsFeed(system, feed as GbfsFeed | "gbfs", state.bikes.all(), deps.publicBaseUrl);
  });

  // GTFS-Realtime TripUpdates for TRA, for OpenTripPlanner's stop-time-updater.
  app.get("/rt/tra-trip-updates.pb", async (_req, reply) => {
    if (!state.traTripUpdates) return reply.code(503).send({ error: "not_ready" });
    return reply.type("application/x-protobuf").send(Buffer.from(state.traTripUpdates));
  });

  // Internal routes used by the API service.
  app.register(async (internal) => {
    internal.addHook("onRequest", async (req, reply) => {
      if (deps.internalToken && req.headers["x-internal-token"] !== deps.internalToken) {
        return reply.code(401).send({ error: "unauthorized" });
      }
    });

    internal.get("/internal/bikes", async (req, reply) => {
      const parsed = BBox.safeParse(numberify(req.query));
      if (!parsed.success) return reply.code(400).send({ error: "invalid_bbox" });
      const b = parsed.data;
      if (b.maxLat - b.minLat > 0.5 || b.maxLon - b.minLon > 0.5)
        return reply.code(400).send({ error: "bbox_too_large" });
      return { stations: state.bikes.inBBox(b) };
    });

    internal.get("/internal/bikes/nearby", async (req, reply) => {
      const parsed = NearbyQuery.safeParse(req.query);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_query" });
      const { lat, lon, radius, limit } = parsed.data;
      return { stations: state.bikes.nearby(lat, lon, radius, limit) };
    });

    internal.post("/internal/bus-eta", async (req, reply) => {
      const parsed = EtaRequest.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
      return { results: parsed.data.queries.map((q) => state.busEta.find(q)) };
    });

    internal.get<{ Params: { stopUid: string } }>("/internal/bus-eta/stop/:stopUid", async (req) => {
      return { results: state.busEta.atStop(req.params.stopUid) };
    });
  });

  return app;
}

function numberify(q: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries((q ?? {}) as Record<string, unknown>)) out[k] = Number(v);
  return out;
}
