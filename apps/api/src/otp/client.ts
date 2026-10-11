export class OtpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "OtpError";
  }
}

export interface OtpClientOptions {
  url: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Minimal GraphQL client for OTP's GTFS GraphQL API. */
export class OtpClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OtpClientOptions) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  async query<T>(query: string, variables: Record<string, unknown>, locale?: string): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.options.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...(locale ? { "accept-language": locale } : {}) },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
      });
    } catch (err) {
      throw new OtpError(`OTP unreachable: ${(err as Error).message}`, null);
    }
    if (!res.ok) throw new OtpError(`OTP HTTP ${res.status}`, res.status);
    const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (body.errors?.length && !body.data) {
      throw new OtpError(`OTP GraphQL error: ${body.errors.map((e) => e.message).join("; ")}`, res.status);
    }
    if (!body.data) throw new OtpError("OTP returned no data", res.status);
    return body.data;
  }
}
