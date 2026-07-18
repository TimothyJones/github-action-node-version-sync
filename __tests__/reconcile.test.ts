import { describe, expect, it } from "vitest";
import {
  commitMessage,
  groupCommits,
  prTitle,
  summarize,
  type FilePlan,
} from "../src/reconcile.js";

function plan(path: string, changes: FilePlan["changes"]): FilePlan {
  return { path, changes, apply: (c) => c };
}

describe("commitMessage", () => {
  it("marks drops as breaking", () => {
    expect(commitMessage("add", 24)).toBe(
      "feat: Add support for node version 24",
    );
    expect(commitMessage("drop", 18)).toBe(
      "feat!: Drop support for node version 18",
    );
  });
});

describe("prTitle", () => {
  it("adds only", () => {
    expect(prTitle([24], [])).toBe("feat: Add support for node version 24");
    expect(prTitle([22, 24], [])).toBe(
      "feat: Add support for node version 22, 24",
    );
  });
  it("drops only", () => {
    expect(prTitle([], [18])).toBe("feat!: Drop support for node version 18");
  });
  it("both adds and drops (breaking)", () => {
    expect(prTitle([24], [18])).toBe(
      "feat!: Add support for node version 24, drop support for node version 18",
    );
  });
});

describe("groupCommits", () => {
  it("groups files by (kind, major) with adds first, then drops, ascending", () => {
    const a = plan("a.yml", [
      { kind: "add", major: 24 },
      { kind: "drop", major: 18 },
    ]);
    const b = plan("b.yml", [{ kind: "drop", major: 18 }]);
    const groups = groupCommits([a, b]);

    expect(groups.map((g) => g.message)).toEqual([
      "feat: Add support for node version 24",
      "feat!: Drop support for node version 18",
    ]);
    // The drop-18 group bundles both files.
    expect(groups[1].plans).toHaveLength(2);
    expect(summarize(groups)).toEqual({ added: [24], removed: [18] });
  });
});
