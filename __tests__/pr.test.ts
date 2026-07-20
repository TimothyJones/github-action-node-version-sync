import { describe, expect, it } from "vitest";
import { buildPrBody } from "../src/pr.js";
import type { CheckImpact, CommitGroup, FilePlan } from "../src/reconcile.js";

function plan(checkImpacts?: CheckImpact[]): FilePlan {
  return { path: "ci.yml", changes: [], checkImpacts, apply: (c) => c };
}

const groups: CommitGroup[] = [
  {
    kind: "drop",
    major: 18,
    message: "feat!: Drop support for node version 18",
    plans: [],
  },
  {
    kind: "add",
    major: 24,
    message: "feat: Add support for node version 24",
    plans: [],
  },
];

describe("buildPrBody required-checks section", () => {
  it("lists exact contexts to remove/add for a simple matrix", () => {
    const body = buildPrBody(
      groups,
      [plan([{ jobId: "test", simple: true, added: ["24"], removed: ["18"] }])],
      "url",
    );
    expect(body).toContain("### Required status checks");
    expect(body).toContain("remove `test (18)`; add `test (24)`");
  });

  it("gives a soft warning for a non-simple matrix", () => {
    const body = buildPrBody(
      groups,
      [
        plan([
          { jobId: "test", simple: false, added: ["24"], removed: ["18"] },
        ]),
      ],
      "url",
    );
    expect(body).toContain("exact check");
    expect(body).toContain("removed 18; added 24");
  });

  it("omits the section when nothing affects check names", () => {
    const body = buildPrBody(groups, [plan(undefined)], "url");
    expect(body).not.toContain("Required status checks");
    expect(body).toContain("Source: url");
  });
});
