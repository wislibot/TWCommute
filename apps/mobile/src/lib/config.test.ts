import { describe, expect, it } from "vitest";
import { normalizeServerUrl } from "./config";

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
