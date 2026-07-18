import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { packageJsonEditor } from "../src/packageJson.js";
import { buildSchedule, type RawSchedule } from "../src/schedule.js";

const rawSchedule = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/schedule.json", import.meta.url)),
    "utf8",
  ),
) as RawSchedule;
const schedule = buildSchedule(rawSchedule, new Date("2025-07-01T00:00:00Z")); // lowestEven = 20

function pkg(engines: string): string {
  return `{\n  "name": "x",\n  "engines": {\n    "node": "${engines}"\n  }\n}\n`;
}

function reconcile(content: string) {
  const plan = packageJsonEditor.plan("package.json", content, schedule);
  if (!plan) return { changed: false, result: content, changes: [] };
  return {
    changed: true,
    result: plan.apply(content, plan.changes[0]),
    changes: plan.changes,
  };
}

describe("packageJsonEditor", () => {
  it("raises a below-floor engines.node to >=lowestEven.0.0 (a drop)", () => {
    const { result, changes } = reconcile(pkg(">=18.0.0"));
    expect(result).toContain('"node": ">=20.0.0"');
    expect(changes).toEqual([{ kind: "drop", major: 18 }]);
  });

  it("leaves a floor already at or above the lowest even active", () => {
    expect(reconcile(pkg(">=20.19.0")).changed).toBe(false);
    expect(reconcile(pkg(">=22")).changed).toBe(false);
  });

  it("uses the lowest mentioned major for OR ranges", () => {
    const { result, changes } = reconcile(pkg("18 || 20 || 22"));
    expect(result).toContain('"node": ">=20.0.0"');
    expect(changes[0].major).toBe(18);
  });

  it("leaves package.json without engines.node untouched", () => {
    expect(reconcile('{\n  "name": "x"\n}\n').changed).toBe(false);
  });

  it("does not disturb the rest of the file", () => {
    const { result } = reconcile(pkg(">=18.0.0"));
    expect(result).toContain('"name": "x"');
    expect(result.startsWith("{\n")).toBe(true);
  });
});
