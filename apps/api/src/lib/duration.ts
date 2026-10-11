/** Parse an ISO-8601 duration ("PT1M30S", "-PT2M", "P1DT1H") into whole seconds. */
export function parseIsoDuration(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const m = /^(-)?P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
    value,
  );
  if (!m) return undefined;
  const [, neg, d, h, min, s] = m;
  const total = Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0);
  return Math.round(neg ? -total : total);
}
