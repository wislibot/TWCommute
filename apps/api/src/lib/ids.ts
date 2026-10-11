/** OTP ids are `FeedId:LocalId`; TDX ids are the local part. */
export function localId(otpId: string | null | undefined): string | undefined {
  if (!otpId) return undefined;
  const i = otpId.indexOf(":");
  return i === -1 ? otpId : otpId.slice(i + 1);
}

export function feedId(otpId: string | null | undefined): string | undefined {
  if (!otpId) return undefined;
  const i = otpId.indexOf(":");
  return i === -1 ? undefined : otpId.slice(0, i);
}

/**
 * TDX GTFS bus route ids are `<SubRouteUID>_<Direction>` (e.g. `TPE104710_0`, verified in the
 * Phase 0 audit). Returns the TDX sub-route and direction used by live ETAs.
 */
export function tdxRouteKey(
  otpRouteId: string | null | undefined,
): { subRouteUid: string; direction?: number } | undefined {
  const local = localId(otpRouteId);
  if (!local) return undefined;
  const m = /^(.+)_(\d+)$/.exec(local);
  return m?.[1] ? { subRouteUid: m[1], direction: Number(m[2]) } : { subRouteUid: local };
}
