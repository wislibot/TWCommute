import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("handles BOM, quotes, escaped quotes, commas and CRLF", () => {
    const text = '﻿stop_id,stop_name\r\n1,"Taipei, Main"\r\n2,"say ""hi"""\r\n';
    expect(parseCsv(text)).toEqual([
      { stop_id: "1", stop_name: "Taipei, Main" },
      { stop_id: "2", stop_name: 'say "hi"' },
    ]);
  });

  it("fills missing trailing fields", () => {
    expect(parseCsv("a,b,c\n1,2")).toEqual([{ a: "1", b: "2", c: "" }]);
  });

  it("returns nothing for empty input", () => {
    expect(parseCsv("")).toEqual([]);
  });
});
