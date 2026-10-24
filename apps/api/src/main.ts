import { loadConfig } from "./config";
import { IngestClient } from "./lib/ingest-client";
import { OtpClient } from "./otp/client";
import { createServer } from "./server";

async function main() {
  const config = loadConfig();
  const app = await createServer({
    otp: new OtpClient({ url: config.OTP_URL }),
    ingest: new IngestClient(config.INGEST_URL, config.INTERNAL_TOKEN),
    liveWindowMinutes: config.LIVE_OVERLAY_WINDOW_MIN,
    planRateLimitPerMin: config.PLAN_RATE_LIMIT_PER_MIN,
    apiToken: config.API_TOKEN,
    logger: true,
  });
  const close = async () => {
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
  await app.listen({ host: config.HOST, port: config.PORT });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
