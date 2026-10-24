import { describe, expect, it } from "vitest";
import { normalizeServerUrl, subnetServerUrls } from "./config";

describe("subnetServerUrls", () => {
  it("lists the other addresses of a home network", () => {
    const urls = subnetServerUrls("192.168.0.105");
    expect(urls).toHaveLength(253);
    expect(urls[0]).toBe("http://192.168.0.1:3000");
    expect(urls).toContain("http://192.168.0.101:3000");
    expect(urls).not.toContain("http://192.168.0.105:3000");
    expect(subnetServerUrls("10.0.2.15")).toHaveLength(253);
    expect(subnetServerUrls("172.20.1.9")).toHaveLength(253);
  });

  it("skips public and missing addresses", () => {
    expect(subnetServerUrls("8.8.8.8")).toEqual([]);
    expect(subnetServerUrls("0.0.0.0")).toEqual([]);
    expect(subnetServerUrls("")).toEqual([]);
  });
});

describe("normalizeServerUrl", () => {
  it("cleans up what people type", () => {
    expect(normalizeServerUrl(" http://192.168.1.20:3000/ ")).toBe("http://192.168.1.20:3000");
    expect(normalizeServerUrl("192.168.1.20:3000")).toBe("http://192.168.1.20:3000");
    expect(normalizeServerUrl("my-pc.local:3000")).toBe("http://my-pc.local:3000");
    expect(normalizeServerUrl("HTTPS://api.example.tw/twc//")).toBe("HTTPS://api.example.tw/twc");
    expect(normalizeServerUrl("http://[fe80::1]:3000")).toBe("http://[fe80::1]:3000");
  });

  it("treats an empty field as the built-in address", () => {
    expect(normalizeServerUrl("")).toBeNull();
    expect(normalizeServerUrl("   ")).toBeNull();
  });

  it("rejects text that is not an http address", () => {
    expect(normalizeServerUrl("ftp://192.168.1.20")).toBeUndefined();
    expect(normalizeServerUrl("http://")).toBeUndefined();
    expect(normalizeServerUrl("192.168.1.20 3000")).toBeUndefined();
    expect(normalizeServerUrl("http://pc:port")).toBeUndefined();
  });
});
