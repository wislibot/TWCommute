/**
 * Build-time configuration (EXPO_PUBLIC_* variables are inlined by Metro).
 * Android emulators reach the host machine at 10.0.2.2, not localhost.
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

/** Vector style. OpenFreeMap needs no key; swap for MapTiler/Protomaps in production if needed. */
export const MAP_STYLE_URL = process.env.EXPO_PUBLIC_MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/liberty";

/** Taipei Main Station: default map center before we know the user's location. */
export const DEFAULT_CENTER: [number, number] = [121.517, 25.0478];
