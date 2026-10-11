import type { Locale } from "@twc/contracts";

const TZ = "Asia/Taipei";

/** "09:05" in Taipei time regardless of the device time zone (tourists often keep home time). */
export function formatTime(iso: string, locale: Locale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--";
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ }).format(d);
}

/** Whole minutes, rounded up so "arrives in 0 min" never shows for a bus 30 s away. */
export function minutesUntil(seconds: number): number {
  return Math.max(0, Math.ceil(seconds / 60));
}

export function durationMinutes(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60));
}

/** "1 h 25 min" / "25 min" — numbers only; units come from the caller's locale strings. */
export function splitDuration(seconds: number): { hours: number; minutes: number } {
  const total = durationMinutes(seconds);
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

export function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
}

/** Minutes between two ISO instants (e.g. the stay at a via stop). */
export function minutesBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000);
}
