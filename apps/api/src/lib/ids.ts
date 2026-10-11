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
