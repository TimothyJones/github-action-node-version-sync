import { describe, expect, it } from "vitest";
import {
  parseVersionLiteral,
  renderVersion,
  representativeStyle,
} from "../src/format.js";

describe("parseVersionLiteral", () => {
  it("reads numbers, bare strings, .x and full versions", () => {
    expect(parseVersionLiteral(20)).toEqual({ major: 20, style: "number" });
    expect(parseVersionLiteral("20")).toEqual({
      major: 20,
      style: "bare-string",
    });
    expect(parseVersionLiteral("20.x")).toEqual({ major: 20, style: "dotx" });
    expect(parseVersionLiteral("20.11.1")).toEqual({
      major: 20,
      style: "full-string",
    });
  });

  it("ignores non-numeric versions", () => {
    for (const v of ["lts/*", "latest", "node", "lts/hydrogen", "*", ">=18"]) {
      expect(parseVersionLiteral(v)).toBeUndefined();
    }
    expect(parseVersionLiteral(true)).toBeUndefined();
    expect(parseVersionLiteral(null)).toBeUndefined();
  });
});

describe("renderVersion", () => {
  it("renders each style", () => {
    expect(renderVersion(24, "number")).toBe(24);
    expect(renderVersion(24, "bare-string")).toBe("24");
    expect(renderVersion(24, "dotx")).toBe("24.x");
    expect(renderVersion(24, "full-string")).toBe("24");
  });
});

describe("representativeStyle", () => {
  it("uses the first entry's style, defaulting to number", () => {
    expect(representativeStyle([{ major: 20, style: "dotx" }])).toBe("dotx");
    expect(representativeStyle([])).toBe("number");
  });
});
