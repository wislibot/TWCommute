import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { BBox, Locale, PlanRequestInput } from "@twc/contracts";
import * as Location from "expo-location";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "./api";

export function useLocale(): Locale {
  return useTranslation().i18n.language as Locale;
}

export function usePlan(req: PlanRequestInput | null) {
  return useQuery({
    queryKey: ["plan", req],
    queryFn: () => api.plan(req as PlanRequestInput),
    enabled: req !== null,
    staleTime: 30_000,
  });
}

export function useSearch(q: string, locale: Locale) {
  const trimmed = q.trim();
  return useQuery({
    queryKey: ["search", trimmed, locale],
    queryFn: () => api.search(trimmed, locale),
    enabled: trimmed.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
}

export function useNearbyStops(pos: { lat: number; lon: number } | null) {
  // Round to ~100 m so small GPS jitter does not refetch.
  const key = pos ? [Math.round(pos.lat * 1000) / 1000, Math.round(pos.lon * 1000) / 1000] : null;
  return useQuery({
    queryKey: ["nearby", key],
    queryFn: () => api.nearbyStops(pos?.lat ?? 0, pos?.lon ?? 0),
    enabled: pos !== null,
    staleTime: 60_000,
  });
}

export function useDepartures(stopId: string) {
  return useQuery({
    queryKey: ["departures", stopId],
    queryFn: () => api.departures(stopId),
    refetchInterval: 30_000,
  });
}

export function useBikes(bbox: BBox | null) {
  return useQuery({
    queryKey: ["bikes", bbox],
    queryFn: () => api.bikes(bbox as BBox),
    enabled: bbox !== null,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
}

/** Current position if the user allows it; null otherwise (the app works without it). */
export function useCurrentPosition() {
  const [pos, setPos] = useState<{ lat: number; lon: number } | null>(null);
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        if (!cancelled) setDenied(true);
        return;
      }
      const last = await Location.getLastKnownPositionAsync();
      if (last && !cancelled) setPos({ lat: last.coords.latitude, lon: last.coords.longitude });
      const fresh = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (!cancelled) setPos({ lat: fresh.coords.latitude, lon: fresh.coords.longitude });
    })().catch(() => {
      if (!cancelled) setDenied(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return { pos, denied };
}
