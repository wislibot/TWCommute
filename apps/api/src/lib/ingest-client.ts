import type { BBox, BikeStation, HealthResponse } from "@twc/contracts";

export interface EtaQuery {
  stopUid: string;
  routeUid?: string;
  subRouteUid?: string;
  direction?: number;
}

export interface EtaResult {
  stopUid: string;
  routeUid: string;
  subRouteUid?: string;
  direction: number;
  etaSeconds: number | null;
  stopStatus: number;
  isLastBus: boolean;
  asOf: string;
}

/** Client for the ingest service's internal routes (live ETAs, bike stations, health). */
export class IngestClient {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly baseUrl: string,
    private readonly token?: string,
    fetchImpl?: typeof fetch,
  ) {
    this.fetchImpl = fetchImpl ?? fetch;
  }

  async busEta(queries: EtaQuery[]): Promise<(EtaResult | null)[]> {
    if (queries.length === 0) return [];
    const body = await this.request<{ results: (EtaResult | null)[] }>("/internal/bus-eta", {
      method: "POST",
      body: JSON.stringify({ queries }),
    });
    return body.results;
  }

  async bikesInBBox(b: BBox): Promise<BikeStation[]> {
    const q = new URLSearchParams(Object.entries(b).map(([k, v]) => [k, String(v)]));
    return (await this.request<{ stations: BikeStation[] }>(`/internal/bikes?${q}`)).stations;
  }

  async bikesNearby(
    lat: number,
    lon: number,
    radius: number,
    limit = 10,
  ): Promise<Array<BikeStation & { distanceMeters: number }>> {
    const q = new URLSearchParams({ lat: String(lat), lon: String(lon), radius: String(radius), limit: String(limit) });
    return (
      await this.request<{ stations: Array<BikeStation & { distanceMeters: number }> }>(`/internal/bikes/nearby?${q}`)
    ).stations;
  }

  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>("/health");
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(this.token ? { "x-internal-token": this.token } : {}),
      },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`ingest ${path} → HTTP ${res.status}`);
    return (await res.json()) as T;
  }
}
