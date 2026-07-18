import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildSchedule,
  fetchSchedule,
  parseMajor,
  type RawSchedule,
} from "../src/schedule.js";

const rawSchedule = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/schedule.json", import.meta.url)),
    "utf8",
  ),
) as RawSchedule;

// Frozen reference date used across the suite: 18 EOL, 20/22/24 active, 26 not yet started.
const NOW = new Date("2025-07-01T00:00:00Z");

describe("buildSchedule", () => {
  const schedule = buildSchedule(rawSchedule, NOW);

  it("computes active even majors and their bounds", () => {
    expect(schedule.activeEven).toEqual([20, 22, 24]);
    expect(schedule.newestEven).toBe(24);
    expect(schedule.lowestEven).toBe(20);
  });

  it("treats a version active only within [start, end)", () => {
    expect(schedule.isActive(18)).toBe(false); // ended 2025-04-30
    expect(schedule.isActive(20)).toBe(true);
    expect(schedule.isActive(23)).toBe(false); // odd, ended 2025-06-01
    expect(schedule.isActive(24)).toBe(true);
    expect(schedule.isActive(26)).toBe(false); // starts 2026
  });

  it("includes active odd majors in `active` but not `activeEven`", () => {
    const early = buildSchedule(rawSchedule, new Date("2025-05-15T00:00:00Z"));
    expect(early.active).toContain(23); // 23 still active mid-May
    expect(early.activeEven).not.toContain(23);
  });
});

describe("parseMajor", () => {
  it("parses vN and N keys", () => {
    expect(parseMajor("v18")).toBe(18);
    expect(parseMajor("20")).toBe(20);
    expect(parseMajor("nightly")).toBeUndefined();
  });
});

describe("fetchSchedule", () => {
  it("reads a local file path", async () => {
    const path = fileURLToPath(
      new URL("./fixtures/schedule.json", import.meta.url),
    );
    const raw = await fetchSchedule(path);
    expect(Object.keys(raw)).toContain("v24");
  });
});
