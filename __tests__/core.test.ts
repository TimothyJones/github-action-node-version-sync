import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyAll, reconcileRepo } from "../src/core.js";
import { discover } from "../src/discover.js";
import { nvmrcEditor } from "../src/nvmrc.js";
import { packageJsonEditor } from "../src/packageJson.js";
import { prTitle, type Editor } from "../src/reconcile.js";
import { buildSchedule, type RawSchedule } from "../src/schedule.js";
import { workflowEditor } from "../src/workflows.js";

function editorFor(name: string): Editor {
  if (name === ".nvmrc") return nvmrcEditor;
  if (name === "package.json") return packageJsonEditor;
  return workflowEditor;
}

const rawSchedule = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/schedule.json", import.meta.url)),
    "utf8",
  ),
) as RawSchedule;
const schedule = buildSchedule(rawSchedule, new Date("2025-07-01T00:00:00Z"));
const repoRoot = fileURLToPath(new URL("./fixtures/repo", import.meta.url));

function byName(final: Map<string, string>, name: string): string {
  for (const [path, content] of final) {
    if (basename(path) === name) return content;
  }
  throw new Error(`no result for ${name}`);
}

describe("reconcileRepo (integration over the fixture repo)", () => {
  it("reconciles workflows, .nvmrc and package.json into one coherent change set", async () => {
    const discovered = await discover(repoRoot);
    const result = await reconcileRepo(discovered, schedule);
    const final = applyAll(result);

    // ci.yml: matrix gains 24 and loses 18; the EOL scalar pin bumps, the current one stays.
    const ci = byName(final, "ci.yml");
    expect(ci).toContain("[20, 22, 24]");
    expect(ci).toContain("# supported LTS lines");
    expect(ci).toContain("node-version: 24"); // lint job bumped from 18
    expect(ci).toContain("node-version: 20"); // release job unchanged
    expect(ci).not.toContain("[18");

    // quoted.yml: gains 22 and 24, loses 18, keeps double-quoted .x style.
    const quoted = byName(final, "quoted.yml");
    expect(quoted).toContain('["20.x", "22.x", "24.x"]');

    // .nvmrc bumped 18 -> 24.
    expect(byName(final, ".nvmrc")).toBe("24\n");

    // engines.node floor raised 18 -> 20.
    expect(byName(final, "package.json")).toContain('"node": ">=20.0.0"');

    // Aggregate summary and title.
    expect(result.added).toEqual([22, 24]);
    expect(result.removed).toEqual([18]);
    expect(prTitle(result.added, result.removed)).toBe(
      "feat!: Drop support for node version 18, add support for node version 22, 24",
    );
  });

  it("is idempotent: re-planning the produced content yields no further changes", async () => {
    const discovered = await discover(repoRoot);
    const first = await reconcileRepo(discovered, schedule);
    expect(first.groups.length).toBeGreaterThan(0);

    const final = applyAll(first);
    for (const [path, content] of final) {
      const plan = editorFor(basename(path)).plan(path, content, schedule);
      expect(
        plan,
        `${basename(path)} should be fully in sync after one pass`,
      ).toBeNull();
    }
  });
});
