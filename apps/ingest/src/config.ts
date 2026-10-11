import { BIKE_CITIES, type BikeCity, BUS_CITIES, type BusCity } from "@twc/tdx";
import { z } from "zod";

function cityList<T extends string>(all: readonly T[], fallback: string) {
  return z
    .string()
    .default(fallback)
    .transform((raw, ctx) => {
      if (raw.trim() === "all") return [...all];
      if (raw.trim() === "") return [];
      const items = raw.split(",").map((s) => s.trim());
      const unknown = items.filter((c) => !all.includes(c as T));
      if (unknown.length) ctx.addIssue({ code: "custom", message: `Unknown cities: ${unknown.join(", ")}` });
      return items as T[];
    });
}

const seconds = (def: number) => z.coerce.number().int().positive().default(def);

const EnvSchema = z.object({
  TDX_CLIENT_ID: z.string().min(1),
  TDX_CLIENT_SECRET: z.string().min(1),
  /**
   * Requests/minute allowed for the TDX key. The free member plan allows 5/minute (measured in
   * Phase 0 from TDX's ratelimit-limit headers); polling all cities needs a paid plan.
   */
  TDX_RATE_PER_MINUTE: z.coerce.number().positive().default(5),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().default(8081),
  /** Base URL other services (OTP) use to reach this service; used inside gbfs.json. */
  PUBLIC_BASE_URL: z.string().default("http://localhost:8081"),
  /** Optional shared secret for /internal/* routes. */
  INTERNAL_TOKEN: z.string().optional(),
  DATA_DIR: z.string().default("./data"),
  // Defaults fit the free TDX plan (5 requests/minute): one city, polled about 2.5 times a minute.
  // Production (all cities, 30-60 s freshness) needs ~60 requests/minute; see docs/DATA.md.
  BIKE_CITIES: cityList<BikeCity>(BIKE_CITIES, "Taipei"),
  BUS_CITIES: cityList<BusCity>(BUS_CITIES, "Taipei"),
  /** Also poll intercity (公路客運) ETAs. */
  BUS_INTERCITY: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  BIKE_AVAILABILITY_INTERVAL_S: seconds(120),
  BIKE_STATIONS_INTERVAL_S: seconds(6 * 3600),
  BUS_ETA_INTERVAL_S: seconds(60),
  TRA_DELAY_INTERVAL_S: seconds(120),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
    throw new Error(`Invalid ingest configuration:\n  ${issues}`);
  }
  return parsed.data;
}

/**
 * Average TDX calls per minute for this configuration. TDX limits per API key, and this number
 * does not depend on how many people use the app.
 */
export function estimatedCallsPerMinute(c: Config): number {
  const busFeeds = c.BUS_CITIES.length + (c.BUS_INTERCITY ? 1 : 0);
  return (
    60 *
    (busFeeds / c.BUS_ETA_INTERVAL_S +
      c.BIKE_CITIES.length / c.BIKE_AVAILABILITY_INTERVAL_S +
      c.BIKE_CITIES.length / c.BIKE_STATIONS_INTERVAL_S +
      busFeeds / (12 * 3600) +
      1 / c.TRA_DELAY_INTERVAL_S)
  );
}
