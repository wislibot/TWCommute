import { timingSafeEqual } from "node:crypto";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { BBox, Locale, PlanRequest } from "@twc/contracts";
import { TPASS_PASSES } from "@twc/fares";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import type { IngestClient } from "./lib/ingest-client";
import type { OtpClient } from "./otp/client";
import { OtpError } from "./otp/client";
import { plan } from "./plan/service";
import { StopIndex, searchStops } from "./stops/search";
import { nearbyStops, stopDepartures } from "./stops/service";

export interface ApiDeps {
  otp: Pick<OtpClient, "query">;
  ingest: Pick<IngestClient, "busEta" | "bikesNearby" | "bikesInBBox" | "health">;
  liveWindowMinutes: number;
  planRateLimitPerMin: number;
  /** When set, /v1 routes other than /v1/health need `Authorization: Bearer <apiToken>`. */
  apiToken?: string;
  now?: () => Date;
  logger?: boolean;
}

/** Constant-time comparison, so response timing does not reveal how much of a key was right. */
function sameKey(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const SearchQuery = z.object({
  q: z.string().trim().min(2).max(60),
  locale: Locale.default("en"),
});

const NearbyQuery = z.object({
  lat: z.coerce.number().min(21).max(27),
  lon: z.coerce.number().min(118).max(123),
  radius: z.coerce.number().int().min(50).max(1500).default(500),
});

export async function createServer(deps: ApiDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? false });
  const stopIndex = new StopIndex(deps.otp);
  await app.register(cors, { origin: true, methods: ["GET", "POST"] });
  await app.register(rateLimit, { global: false });

  const { apiToken } = deps;
  if (apiToken) {
    // Health stays open: the app uses it to find the server and tell "wrong key" from "no server".
    app.addHook("onRequest", async (req, reply) => {
      if (!req.url.startsWith("/v1/") || req.url.startsWith("/v1/health")) return;
      const given = req.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
      if (!sameKey(given, apiToken)) return reply.code(401).send({ error: "unauthorized" });
    });
  }

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof OtpError) {
      req.log.error({ err: err.message }, "router error");
      return reply.code(503).send({ error: "router_unavailable" });
    }
    if ((err as { statusCode?: number }).statusCode === 429) return reply.code(429).send({ error: "rate_limited" });
    req.log.error(err);
    return reply.code(500).send({ error: "internal" });
  });

  app.post(
    "/v1/plan",
    { config: { rateLimit: { max: deps.planRateLimitPerMin, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const parsed = PlanRequest.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_request", issues: parsed.error.issues });
      return plan(parsed.data, deps);
    },
  );

  app.get("/v1/search", async (req, reply) => {
    const parsed = SearchQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_query" });
    return { results: await searchStops(parsed.data.q, parsed.data.locale, { index: stopIndex }) };
  });

  app.get("/v1/stops/nearby", async (req, reply) => {
    const parsed = NearbyQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_query" });
    const { lat, lon, radius } = parsed.data;
    return { stops: await nearbyStops(lat, lon, radius, deps) };
  });

  app.get<{ Params: { id: string } }>("/v1/stops/:id/departures", async (req, reply) => {
    const board = await stopDepartures(req.params.id, deps);
    if (!board) return reply.code(404).send({ error: "stop_not_found" });
    return board;
  });

  app.get("/v1/bikes", async (req, reply) => {
    const parsed = BBox.safeParse(
      Object.fromEntries(Object.entries(req.query as Record<string, string>).map(([k, v]) => [k, Number(v)])),
    );
    if (!parsed.success) return reply.code(400).send({ error: "invalid_bbox" });
    const b = parsed.data;
    if (b.maxLat - b.minLat > 0.2 || b.maxLon - b.minLon > 0.2)
      return reply.code(400).send({ error: "bbox_too_large" });
    return { stations: await deps.ingest.bikesInBBox(b) };
  });

  app.get("/v1/tpass/passes", async () => ({
    passes: TPASS_PASSES.map(({ id, name, priceTwd, residentPriceTwd, cities, verifiedAt }) => ({
      id,
      name,
      priceTwd,
      residentPriceTwd,
      cities,
      verifiedAt,
    })),
  }));

  app.get("/v1/health", async (_req, reply) => {
    const [ingest, router] = await Promise.allSettled([
      deps.ingest.health(),
      deps.otp.query("{ feeds { feedId } }", {}),
    ]);
    const body = {
      status:
        ingest.status === "fulfilled" && ingest.value.status === "ok" && router.status === "fulfilled"
          ? "ok"
          : "degraded",
      router: router.status === "fulfilled" ? "ok" : "unavailable",
      feeds: ingest.status === "fulfilled" ? ingest.value.feeds : [],
      ...(ingest.status === "fulfilled" && ingest.value.busLive ? { busLive: ingest.value.busLive } : {}),
    };
    return reply.code(router.status === "fulfilled" ? 200 : 503).send(body);
  });

  return app;
}
