import { readFile } from "node:fs/promises";
import type { Discovered } from "./discover.js";
import { nvmrcEditor } from "./nvmrc.js";
import { packageJsonEditor } from "./packageJson.js";
import {
  groupCommits,
  summarize,
  type CommitGroup,
  type Editor,
  type FilePlan,
} from "./reconcile.js";
import type { Schedule } from "./schedule.js";
import { workflowEditor } from "./workflows.js";

export interface ReconcileResult {
  plans: FilePlan[];
  groups: CommitGroup[];
  added: number[];
  removed: number[];
  /** Original content of every file that has a plan, keyed by absolute path. */
  originals: Map<string, string>;
}

async function planFiles(
  paths: string[],
  editor: Editor,
  schedule: Schedule,
  plans: FilePlan[],
  originals: Map<string, string>,
): Promise<void> {
  for (const path of paths) {
    const content = await readFile(path, "utf8");
    const plan = editor.plan(path, content, schedule);
    if (plan && plan.changes.length > 0) {
      plans.push(plan);
      originals.set(path, content);
    }
  }
}

/** Run every editor over the discovered files and assemble the commit groups. */
export async function reconcileRepo(
  discovered: Discovered,
  schedule: Schedule,
): Promise<ReconcileResult> {
  const plans: FilePlan[] = [];
  const originals = new Map<string, string>();

  await planFiles(
    discovered.workflows,
    workflowEditor,
    schedule,
    plans,
    originals,
  );
  await planFiles(discovered.nvmrc, nvmrcEditor, schedule, plans, originals);
  await planFiles(
    discovered.packageJson,
    packageJsonEditor,
    schedule,
    plans,
    originals,
  );

  const groups = groupCommits(plans);
  const { added, removed } = summarize(groups);
  return { plans, groups, added, removed, originals };
}

/**
 * Apply every commit group's edits to an in-memory copy of the file contents and
 * return the final state, keyed by absolute path. Pure — does not touch disk.
 * Applying groups in order (adds before drops) mirrors how they are committed.
 */
export function applyAll(result: ReconcileResult): Map<string, string> {
  const contents = new Map(result.originals);
  for (const group of result.groups) {
    for (const plan of group.plans) {
      const current = contents.get(plan.path) ?? "";
      contents.set(
        plan.path,
        plan.apply(current, { kind: group.kind, major: group.major }),
      );
    }
  }
  return contents;
}
