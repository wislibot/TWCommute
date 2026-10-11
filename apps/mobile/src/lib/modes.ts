import type { LegMode } from "@twc/contracts";

/** Default colors per mode; a route's own color (e.g. MRT line color) wins when present. */
export const MODE_COLORS: Record<LegMode, string> = {
  WALK: "#6B7280",
  BICYCLE: "#F5A300",
  SUBWAY: "#0070BD",
  RAIL: "#1E3A8A",
  BUS: "#16A34A",
  COACH: "#0F766E",
  TRAM: "#7C3AED",
  FERRY: "#0891B2",
  GONDOLA: "#B45309",
  AIRPLANE: "#475569",
  OTHER: "#64748B",
};

export function legColor(mode: LegMode, routeColor?: string): string {
  return routeColor && /^#[0-9a-f]{6}$/i.test(routeColor) ? routeColor : MODE_COLORS[mode];
}

/** Pick black or white text for a background color (WCAG relative luminance). */
export function textOn(hex: string): "#000000" | "#FFFFFF" {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return "#FFFFFF";
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => {
    const c = Number.parseInt(h ?? "0", 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? "#000000" : "#FFFFFF";
}
