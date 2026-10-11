import { z } from "zod";

const EnvSchema = z.object({
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().default(3000),
  /** OTP GTFS GraphQL endpoint. */
  OTP_URL: z.string().default("http://localhost:8080/otp/gtfs/v1"),
  INGEST_URL: z.string().default("http://localhost:8081"),
  INTERNAL_TOKEN: z.string().optional(),
  /** Requests per minute per IP for /v1/plan (routing is CPU-heavy). */
  PLAN_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(30),
  /** Bus legs departing within this window get the TDX live-ETA overlay. */
  LIVE_OVERLAY_WINDOW_MIN: z.coerce.number().int().positive().default(45),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return EnvSchema.parse(env);
}
