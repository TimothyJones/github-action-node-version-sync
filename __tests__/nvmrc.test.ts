import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { nvmrcEditor } from "../src/nvmrc.js";
import { buildSchedule, type RawSchedule } from "../src/schedule.js";

const rawSchedule = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/schedule.json", import.meta.url)),
    "utf8",
  ),
) as RawSchedule;
const schedule = buildSchedule(rawSchedule, new Date("2025-07-01T00:00:00Z"));

function reconcile(content: string) {
  const plan = nvmrcEditor.plan(".nvmrc", content, schedule);
  if (!plan) return { changed: false, result: content };
  const result = plan.apply(content, plan.changes[0]);
  return { changed: true, result };
}

describe("nvmrcEditor", () => {
  it("bumps an EOL version to the newest even active, preserving the trailing newline", () => {
    expect(reconcile("18\n")).toEqual({ changed: true, result: "24\n" });
  });

  it("preserves a `v` prefix", () => {
    expect(reconcile("v18.20.0\n")).toEqual({ changed: true, result: "v24\n" });
  });

  it("leaves a still-active version alone", () => {
    expect(reconcile("20\n").changed).toBe(false);
  });

  it("leaves non-numeric aliases alone", () => {
    expect(reconcile("lts/hydrogen\n").changed).toBe(false);
  });
});
