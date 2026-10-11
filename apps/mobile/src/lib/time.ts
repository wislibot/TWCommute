/** ISO-8601 with +08:00 offset for Asia/Taipei (no DST), as the API expects. */
export function toTaipeiIso(d: Date): string {
  const shifted = new Date(d.getTime() + 8 * 3600_000);
  return `${shifted.toISOString().slice(0, 19)}+08:00`;
}
