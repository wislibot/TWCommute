import type {
  BBox,
  BikeStation,
  DepartureBoard,
  Locale,
  PlanRequestInput,
  PlanResponse,
  SearchResponse,
  StopSummary,
} from "@twc/contracts";
import { API_URL } from "./config";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { accept: "application/json", ...(init?.body ? { "content-type": "application/json" } : {}) },
    });
  } catch (err) {
    throw new ApiError((err as Error).message, null);
  }
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  return (await res.json()) as T;
}

const qs = (params: Record<string, string | number>) =>
  new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();

export const api = {
  plan: (req: PlanRequestInput) => request<PlanResponse>("/v1/plan", { method: "POST", body: JSON.stringify(req) }),
  search: (q: string, locale: Locale) => request<SearchResponse>(`/v1/search?${qs({ q, locale })}`),
  nearbyStops: (lat: number, lon: number, radius = 500) =>
    request<{ stops: StopSummary[] }>(`/v1/stops/nearby?${qs({ lat, lon, radius })}`),
  departures: (stopId: string) => request<DepartureBoard>(`/v1/stops/${encodeURIComponent(stopId)}/departures`),
  bikes: (b: BBox) => request<{ stations: BikeStation[] }>(`/v1/bikes?${qs({ ...b })}`),
};
