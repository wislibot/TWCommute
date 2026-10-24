import * as Network from "expo-network";
import { subnetServerUrls } from "./config";

/** Probes in flight at once; 254 addresses take about 8 rounds. */
const PARALLEL = 32;
const PROBE_TIMEOUT_MS = 1500;

/** Does a TWCommute API answer here? Its health route is open even when an access key is set. */
async function isServer(url: string): Promise<boolean> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), PROBE_TIMEOUT_MS);
  try {
    // A 503 (router still starting) is still our server, so the body decides, not the status.
    const body = (await (await fetch(`${url}/v1/health`, { signal: abort.signal })).json()) as { feeds?: unknown };
    return Array.isArray(body?.feeds);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * TWCommute servers on the phone's Wi-Fi: a computer running try-it.sh, or a laptop forwarding one
 * through an SSH tunnel. Takes about 10 seconds.
 */
export async function findServers(): Promise<string[]> {
  const candidates = subnetServerUrls(await Network.getIpAddressAsync());
  const found: string[] = [];
  for (let i = 0; i < candidates.length; i += PARALLEL) {
    const batch = candidates.slice(i, i + PARALLEL);
    const hits = await Promise.all(batch.map(isServer));
    found.push(...batch.filter((_, k) => hits[k]));
  }
  return found;
}
