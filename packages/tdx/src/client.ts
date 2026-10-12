import { type Clock, RateLimiter, systemClock } from "./rate-limiter";

export const TDX_AUTH_URL = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
export const TDX_BASIC_BASE = "https://tdx.transportdata.tw/api/basic";
export const TDX_GTFS_BASE = "https://tdx.transportdata.tw/api/gtfs";

export interface TdxClientOptions {
  clientId: string;
  clientSecret: string;
  /** Requests per minute allowed for this key (TDX subscription tier; the free plan allows 5). */
  ratePerMinute?: number;
  /** The window `ratePerMinute` is enforced over; slightly over a minute leaves a margin. */
  rateWindowMs?: number;
  maxRetries?: number;
  /** Refresh the token this long before it expires. */
  tokenRefreshMarginMs?: number;
  fetch?: typeof fetch;
  clock?: Clock;
  authUrl?: string;
  /** Observe every data response (not token requests), e.g. to count calls or read rate-limit headers. */
  onResponse?: (info: { url: string; status: number; headers: Headers }) => void;
}

export class TdxError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly url: string,
  ) {
    super(message);
    this.name = "TdxError";
  }
}

export type Query = Record<string, string | number | undefined>;

interface Token {
  value: string;
  expiresAt: number;
}

/**
 * Server-side TDX client. Only the ingest service should hold credentials: the mobile app
 * never calls TDX directly, so TDX usage does not grow with the number of users.
 */
export class TdxClient {
  private token: Token | null = null;
  private tokenRequest: Promise<Token> | null = null;
  private readonly limiter: RateLimiter;
  private readonly fetchImpl: typeof fetch;
  private readonly clock: Clock;
  private readonly maxRetries: number;
  private readonly refreshMarginMs: number;
  private readonly authUrl: string;

  constructor(private readonly options: TdxClientOptions) {
    if (!options.clientId || !options.clientSecret) {
      throw new Error("TDX clientId and clientSecret are required");
    }
    this.clock = options.clock ?? systemClock;
    this.fetchImpl = options.fetch ?? fetch;
    this.limiter = new RateLimiter(options.ratePerMinute ?? 5, options.rateWindowMs ?? 61_000, this.clock);
    this.maxRetries = options.maxRetries ?? 3;
    this.refreshMarginMs = options.tokenRefreshMarginMs ?? 5 * 60_000;
    this.authUrl = options.authUrl ?? TDX_AUTH_URL;
  }

  /** GET a JSON resource from the TDX basic API, e.g. `/v2/Bike/Station/City/Taipei`. */
  async getJson<T>(path: string, query: Query = {}, base = TDX_BASIC_BASE): Promise<T> {
    const url = buildUrl(base, path, { $format: "JSON", ...query });
    const res = await this.request(url, "application/json");
    return (await res.json()) as T;
  }

  /** GET a binary resource (e.g. a GTFS zip). */
  async getBinary(path: string, base = TDX_GTFS_BASE): Promise<Uint8Array> {
    const url = buildUrl(base, path, {});
    const res = await this.request(url, "application/octet-stream, */*");
    return new Uint8Array(await res.arrayBuffer());
  }

  private async request(url: string, accept: string): Promise<Response> {
    let refreshedToken = false;
    for (let attempt = 0; ; attempt++) {
      const token = await this.getToken();
      await this.limiter.acquire();
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          headers: { authorization: `Bearer ${token.value}`, accept },
        });
      } catch (err) {
        if (attempt >= this.maxRetries) {
          throw new TdxError(`Network error: ${(err as Error).message}`, null, url);
        }
        await this.clock.sleep(backoffMs(attempt));
        continue;
      }
      this.options.onResponse?.({ url, status: res.status, headers: res.headers });
      if (res.ok) return res;
      if (res.status === 401 && !refreshedToken) {
        refreshedToken = true;
        this.token = null;
        continue;
      }
      if (res.status === 429 && attempt < this.maxRetries) {
        // Over the key's quota: hold every request from this client, not just this one.
        this.limiter.pause(retryAfterMs(res) ?? backoffMs(attempt));
        continue;
      }
      if (res.status >= 500 && attempt < this.maxRetries) {
        await this.clock.sleep(retryAfterMs(res) ?? backoffMs(attempt));
        continue;
      }
      const body = await safeText(res);
      throw new TdxError(`TDX ${res.status}: ${body.slice(0, 300)}`, res.status, url);
    }
  }

  private async getToken(): Promise<Token> {
    if (this.token && this.clock.now() < this.token.expiresAt - this.refreshMarginMs) {
      return this.token;
    }
    // Single-flight: concurrent callers share one token request (the token endpoint is
    // limited to 20 calls/min per IP).
    this.tokenRequest ??= this.fetchToken().finally(() => {
      this.tokenRequest = null;
    });
    this.token = await this.tokenRequest;
    return this.token;
  }

  private async fetchToken(): Promise<Token> {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
    });
    const res = await this.fetchImpl(this.authUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      throw new TdxError(
        `TDX auth failed (${res.status}): ${(await safeText(res)).slice(0, 200)}`,
        res.status,
        this.authUrl,
      );
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new TdxError("TDX auth response had no access_token", res.status, this.authUrl);
    return { value: json.access_token, expiresAt: this.clock.now() + (json.expires_in ?? 86_400) * 1000 };
  }
}

export function buildUrl(base: string, path: string, query: Query): string {
  const url = new URL(base.replace(/\/$/, "") + (path.startsWith("/") ? path : `/${path}`));
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function backoffMs(attempt: number): number {
  return 1000 * 2 ** attempt;
}

function retryAfterMs(res: Response): number | null {
  const header = res.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? Math.min(seconds, 60) * 1000 : null;
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
