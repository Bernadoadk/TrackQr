import { describe, expect, it } from "vitest";
import { csvCell, parseCsv, toCsv } from "./csv.server";

describe("csvCell", () => {
  it("neutralizes spreadsheet formulas", () => {
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe("\"'=HYPERLINK(\"\"http://evil\"\")\"");
    expect(csvCell("+cmd")).toBe("'+cmd");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("-2+3")).toBe("'-2+3");
  });

  it("keeps negative numbers and plain values", () => {
    expect(csvCell("-12.5")).toBe("-12.5");
    expect(csvCell(42)).toBe("42");
    expect(csvCell(null)).toBe("");
  });

  it("quotes separators, quotes and new lines", () => {
    expect(csvCell("a,b")).toBe("\"a,b\"");
    expect(csvCell("say \"hi\"")).toBe("\"say \"\"hi\"\"\"");
    expect(csvCell("l1\nl2")).toBe("\"l1\nl2\"");
  });
});

describe("toCsv", () => {
  it("writes a header and one line per row", () => {
    const csv = toCsv([{ name: "Flyer", scans: 3 }], [{ key: "name", label: "Name" }, { key: "scans", label: "Scans" }]);
    expect(csv).toBe("Name,Scans\nFlyer,3");
  });
});

describe("parseCsv", () => {
  it("handles quoted fields, escaped quotes and CRLF", () => {
    expect(parseCsv("name,url\r\n\"Tee, blue\",\"https://a.com/?q=\"\"x\"\"\"\r\n")).toEqual([
      ["name", "url"],
      ["Tee, blue", "https://a.com/?q=\"x\""],
    ]);
  });

  it("detects semicolon separators and strips the BOM", () => {
    expect(parseCsv("﻿name;type\nFlyer;url")).toEqual([["name", "type"], ["Flyer", "url"]]);
  });

  it("skips empty lines and caps the row count (header excluded)", () => {
    expect(parseCsv("a\n\n1\n2\n3", 2)).toEqual([["a"], ["1"], ["2"]]);
  });
});
