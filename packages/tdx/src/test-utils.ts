import type { Clock } from "./rate-limiter";

/** Deterministic clock: sleeping advances time instantly. */
export class FakeClock implements Clock {
  readonly sleeps: number[] = [];
  constructor(public t = 0) {}
  now(): number {
    return this.t;
  }
  async sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.t += ms;
  }
}

export interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

/** A fetch stub that answers from a handler and records every call. */
export function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: RecordedCall[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { fetch: fn, calls };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}
