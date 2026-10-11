import { describe, expect, it } from "vitest";
import { displayName, resolveLocale, resources } from "./index";

function keys(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null) return [prefix];
  return Object.entries(obj).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

function placeholders(s: string): string[] {
  return [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1] ?? "").sort();
}

function lookup(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
}

describe("locales", () => {
  const base = keys(resources.en.translation).sort();

  for (const [locale, { translation }] of Object.entries(resources)) {
    it(`${locale} has exactly the English keys and placeholders`, () => {
      expect(keys(translation).sort()).toEqual(base);
      for (const key of base) {
        const en = String(lookup(resources.en.translation, key));
        const other = String(lookup(translation, key));
        expect(placeholders(other), `${locale}:${key}`).toEqual(placeholders(en));
      }
    });
  }
});

describe("resolveLocale", () => {
  it("maps device tags", () => {
    expect(resolveLocale("zh-Hant-TW")).toBe("zh-TW");
    expect(resolveLocale("ja-JP")).toBe("ja");
    expect(resolveLocale("ko")).toBe("ko");
    expect(resolveLocale("fr-FR")).toBe("en");
    expect(resolveLocale(undefined)).toBe("en");
  });
});

describe("displayName", () => {
  const name = { zh: "臺北車站", en: "Taipei Main Station" };
  it("keeps signage languages visible", () => {
    expect(displayName(name, "zh-TW")).toEqual({ primary: "臺北車站" });
    expect(displayName(name, "en")).toEqual({ primary: "Taipei Main Station", secondary: "臺北車站" });
    expect(displayName(name, "ja")).toEqual({ primary: "臺北車站", secondary: "Taipei Main Station" });
    expect(displayName(name, "ko")).toEqual({ primary: "Taipei Main Station", secondary: "臺北車站" });
    expect(displayName({ zh: "公館" }, "en")).toEqual({ primary: "公館" });
  });
});
