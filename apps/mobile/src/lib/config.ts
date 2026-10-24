/**
 * Build-time configuration (EXPO_PUBLIC_* variables are inlined by Metro).
 * Android emulators reach the host machine at 10.0.2.2, not localhost.
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

/**
 * A server address typed in Settings, cleaned up: trimmed, `http://` added when no scheme is given,
 * trailing slashes removed. Returns null for an empty field (use API_URL) and undefined for text
 * that isn't an http(s) address with a host.
 */
export function normalizeServerUrl(text: string): string | null | undefined {
  let url = text.trim().replace(/\/+$/, "");
  if (!url) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `http://${url}`;
  return /^https?:\/\/([a-z0-9-]+(\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])(:\d{1,5})?(\/\S*)?$/i.test(url) ? url : undefined;
}

/** The port try-it.sh runs the API on, and the one an SSH tunnel on a laptop forwards. */
export const SERVER_PORT = 3000;

/**
 * Every other address on the phone's home network (its /24, as home routers hand out), where a
 * TWCommute server could listen. Empty when the phone has no private IPv4 address.
 */
export function subnetServerUrls(phoneIp: string): string[] {
  const m = /^(10\.\d{1,3}|172\.(1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}$/.test(phoneIp)
    ? /^(\d+\.\d+\.\d+)\.(\d+)$/.exec(phoneIp)
    : null;
  if (!m) return [];
  const [, prefix, own] = m;
  return Array.from({ length: 254 }, (_, i) => i + 1)
    .filter((n) => String(n) !== own)
    .map((n) => `http://${prefix}.${n}:${SERVER_PORT}`);
}

/** Vector style. OpenFreeMap needs no key; swap for MapTiler/Protomaps in production if needed. */
export const MAP_STYLE_URL = process.env.EXPO_PUBLIC_MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/liberty";

/** Taipei Main Station: default map center before we know the user's location. */
export const DEFAULT_CENTER: [number, number] = [121.517, 25.0478];
