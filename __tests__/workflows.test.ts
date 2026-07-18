import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { groupCommits, type Editor } from "../src/reconcile.js";
import { buildSchedule, type RawSchedule } from "../src/schedule.js";
import { workflowEditor } from "../src/workflows.js";

const rawSchedule = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/schedule.json", import.meta.url)),
    "utf8",
  ),
) as RawSchedule;
const schedule = buildSchedule(rawSchedule, new Date("2025-07-01T00:00:00Z"));

/** Plan a file then apply every change in commit order, returning the final content + changes. */
function reconcile(content: string, editor: Editor = workflowEditor) {
  const plan = editor.plan("workflow.yml", content, schedule);
  if (!plan) return { changed: false, result: content, changes: [] };
  let result = content;
  for (const group of groupCommits([plan])) {
    result = plan.apply(result, { kind: group.kind, major: group.major });
  }
  return { changed: true, result, changes: plan.changes };
}

describe("matrix arrays", () => {
  it("adds missing even majors and drops EOL ones, preserving comments", () => {
    const input = [
      "jobs:",
      "  test:",
      "    strategy:",
      "      matrix:",
      "        node: [18, 20, 22] # supported LTS lines",
      "    steps:",
      "      - uses: actions/setup-node@v4",
      "        with:",
      "          node-version: ${{ matrix.node }}",
      "",
    ].join("\n");

    const { result } = reconcile(input);
    expect(result).toContain("[20, 22, 24]");
    expect(result).toContain("# supported LTS lines");
    expect(result).not.toContain("18");
  });

  it("preserves quoted `.x` style when inserting", () => {
    const input = [
      "jobs:",
      "  compat:",
      "    strategy:",
      "      matrix:",
      '        node-version: ["18.x", "20.x"]',
      "    steps:",
      "      - uses: actions/setup-node@v4",
      "        with:",
      "          node-version: ${{ matrix.node-version }}",
      "",
    ].join("\n");

    const { result } = reconcile(input);
    expect(result).toContain('"20.x"');
    expect(result).toContain('"22.x"');
    expect(result).toContain('"24.x"');
    expect(result).not.toContain('"18.x"');
  });
});

describe("scalar pins", () => {
  it("bumps an EOL pin to the newest even active, leaves current pins alone", () => {
    const input = [
      "jobs:",
      "  a:",
      "    steps:",
      "      - uses: actions/setup-node@v4",
      "        with:",
      "          node-version: 18",
      "  b:",
      "    steps:",
      "      - uses: actions/setup-node@v4",
      "        with:",
      "          node-version: 20",
      "",
    ].join("\n");

    const { result, changes } = reconcile(input);
    expect(result).toContain("node-version: 24");
    expect(result).toContain("node-version: 20");
    expect(changes).toEqual([{ kind: "drop", major: 18 }]);
  });

  it("leaves non-numeric versions untouched", () => {
    const input = [
      "jobs:",
      "  a:",
      "    steps:",
      "      - uses: actions/setup-node@v4",
      "        with:",
      "          node-version: lts/*",
      "",
    ].join("\n");
    const { changed, result } = reconcile(input);
    expect(changed).toBe(false);
    expect(result).toContain("lts/*");
  });
});
