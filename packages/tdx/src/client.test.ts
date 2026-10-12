import { describe, expect, it } from "vitest";
import { buildUrl, TDX_AUTH_URL, TdxClient, TdxError } from "./client";
import { getBusEta, routeUidFilter } from "./endpoints";
import { FakeClock, json, stubFetch } from "./test-utils";

const creds = { clientId: "id", clientSecret: "secret" };

function tokenResponse(token = "tok-1", expiresIn = 86_400) {
  return json({ access_token: token, expires_in: expiresIn, token_type: "Bearer" });
}

describe("TdxClient", () => {
  it("fetches a token once and reuses it", async () => {
    const { fetch, calls } = stubFetch((url) => (url === TDX_AUTH_URL ? tokenResponse() : json([{ ok: 1 }])));
    const client = new TdxClient({ ...creds, fetch, clock: new FakeClock() });

    await client.getJson("/v2/Bike/Station/City/Taipei");
    await client.getJson("/v2/Bike/Availability/City/Taipei");

    expect(calls.filter((c) => c.url === TDX_AUTH_URL)).toHaveLength(1);
    const dataCall = calls[1];
    expect(dataCall?.url).toBe("https://tdx.transportdata.tw/api/basic/v2/Bike/Station/City/Taipei?%24format=JSON");
    expect(new Headers(dataCall?.init?.headers).get("authorization")).toBe("Bearer tok-1");
    const authBody = calls[0]?.init?.body as URLSearchParams;
    expect(authBody.get("grant_type")).toBe("client_credentials");
    expect(authBody.get("client_id")).toBe("id");
  });

  it("shares a single in-flight token request between concurrent calls", async () => {
    const { fetch, calls } = stubFetch((url) => (url === TDX_AUTH_URL ? tokenResponse() : json([])));
    const client = new TdxClient({ ...creds, fetch, clock: new FakeClock(), ratePerMinute: 6000 });
    await Promise.all([client.getJson("/a"), client.getJson("/b"), client.getJson("/c")]);
    expect(calls.filter((c) => c.url === TDX_AUTH_URL)).toHaveLength(1);
  });

  it("refreshes the token before it expires", async () => {
    const clock = new FakeClock();
    let n = 0;
    const { fetch, calls } = stubFetch((url) => (url === TDX_AUTH_URL ? tokenResponse(`tok-${++n}`, 600) : json([])));
    const client = new TdxClient({ ...creds, fetch, clock, tokenRefreshMarginMs: 60_000 });
    await client.getJson("/a");
    clock.t += 540_001; // past expiry minus margin
    await client.getJson("/b");
    expect(calls.filter((c) => c.url === TDX_AUTH_URL)).toHaveLength(2);
    expect(new Headers(calls.at(-1)?.init?.headers).get("authorization")).toBe("Bearer tok-2");
  });

  it("re-authenticates once on 401", async () => {
    let n = 0;
    let dataCalls = 0;
    const { fetch } = stubFetch((url) => {
      if (url === TDX_AUTH_URL) return tokenResponse(`tok-${++n}`);
      dataCalls++;
      return dataCalls === 1 ? json({ message: "expired" }, 401) : json([1]);
    });
    const client = new TdxClient({ ...creds, fetch, clock: new FakeClock() });
    await expect(client.getJson("/a")).resolves.toEqual([1]);
    expect(n).toBe(2);
  });

  it("pauses for Retry-After on 429, then succeeds", async () => {
    const clock = new FakeClock();
    let dataCalls = 0;
    const { fetch } = stubFetch((url) => {
      if (url === TDX_AUTH_URL) return tokenResponse();
      dataCalls++;
      return dataCalls === 1 ? json({}, 429, { "retry-after": "3" }) : json(["ok"]);
    });
    const client = new TdxClient({ ...creds, fetch, clock });
    await expect(client.getJson("/a")).resolves.toEqual(["ok"]);
    expect(clock.sleeps).toContain(3000);
  });

  it("gives up after maxRetries on 5xx with a TdxError", async () => {
    const { fetch } = stubFetch((url) =>
      url === TDX_AUTH_URL ? tokenResponse() : new Response("boom", { status: 503 }),
    );
    const client = new TdxClient({ ...creds, fetch, clock: new FakeClock(), maxRetries: 2 });
    const err = await client.getJson("/a").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TdxError);
    expect((err as TdxError).status).toBe(503);
  });

  it("does not retry other 4xx errors", async () => {
    let dataCalls = 0;
    const { fetch } = stubFetch((url) => {
      if (url === TDX_AUTH_URL) return tokenResponse();
      dataCalls++;
      return new Response("bad", { status: 400 });
    });
    const client = new TdxClient({ ...creds, fetch, clock: new FakeClock() });
    await expect(client.getJson("/a")).rejects.toThrow(/TDX 400/);
    expect(dataCalls).toBe(1);
  });

  it("requires credentials", () => {
    expect(() => new TdxClient({ clientId: "", clientSecret: "" })).toThrow();
  });
});

describe("endpoints", () => {
  it("selects only the fields we use for bus ETAs", async () => {
    const { fetch, calls } = stubFetch((url) => (url === TDX_AUTH_URL ? tokenResponse() : json([])));
    const client = new TdxClient({ ...creds, fetch, clock: new FakeClock() });
    await getBusEta(client, "InterCity");
    const url = new URL(calls[1]?.url ?? "");
    expect(url.pathname).toBe("/api/basic/v2/Bus/EstimatedTimeOfArrival/InterCity");
    expect(url.searchParams.get("$select")).toContain("EstimateTime");
    expect(url.searchParams.has("$filter")).toBe(false);
  });

  it("filters bus ETAs by route", async () => {
    const { fetch, calls } = stubFetch((url) => (url === TDX_AUTH_URL ? tokenResponse() : json([])));
    const client = new TdxClient({ ...creds, fetch, clock: new FakeClock() });
    await getBusEta(client, "InterCity", ["THB5608", "THB9003"]);
    // TDX accepts this encoding (spaces as '+'; checked live in Oct 2026).
    expect(calls[1]?.url).toContain("&%24filter=RouteUID+eq+%27THB5608%27+or+RouteUID+eq+%27THB9003%27");
    await getBusEta(client, "InterCity", []);
    expect(calls[2]?.url).not.toContain("filter");
  });

  it("rejects RouteUIDs that would need quoting in $filter", () => {
    expect(() => routeUidFilter(["THB5608", "x' or 1 eq 1"])).toThrow(/Invalid RouteUIDs: x' or 1 eq 1/);
  });
});

describe("buildUrl", () => {
  it("joins paths and skips undefined params", () => {
    expect(buildUrl("https://x.test/api/", "/v2/a", { $top: 5, skip: undefined })).toBe(
      "https://x.test/api/v2/a?%24top=5",
    );
  });
});

describe("onResponse", () => {
  it("reports every data response, including retried ones", async () => {
    let dataCalls = 0;
    const seen: number[] = [];
    const { fetch } = stubFetch((url) => {
      if (url === TDX_AUTH_URL) return tokenResponse();
      dataCalls++;
      return dataCalls === 1 ? json({}, 503) : json([], 200, { "x-ratelimit-remaining": "9" });
    });
    const client = new TdxClient({ ...creds, fetch, clock: new FakeClock(), onResponse: (r) => seen.push(r.status) });
    await client.getJson("/a");
    expect(seen).toEqual([503, 200]);
  });
});
