import type { getOctokit } from "@actions/github";
import type { CommitGroup, FilePlan } from "./reconcile.js";

export type Octokit = ReturnType<typeof getOctokit>;

export interface PrOptions {
  owner: string;
  repo: string;
  base: string;
  branch: string;
  title: string;
  body: string;
}

export interface PrResult {
  url: string;
  number: number;
}

/** Create the PR, or update the existing open one from the same head branch. */
export async function upsertPullRequest(
  octokit: Octokit,
  opts: PrOptions,
): Promise<PrResult> {
  const head = `${opts.owner}:${opts.branch}`;

  const existing = await octokit.rest.pulls.list({
    owner: opts.owner,
    repo: opts.repo,
    head,
    base: opts.base,
    state: "open",
  });

  if (existing.data.length > 0) {
    const pr = existing.data[0];
    await octokit.rest.pulls.update({
      owner: opts.owner,
      repo: opts.repo,
      pull_number: pr.number,
      title: opts.title,
      body: opts.body,
    });
    return { url: pr.html_url, number: pr.number };
  }

  const created = await octokit.rest.pulls.create({
    owner: opts.owner,
    repo: opts.repo,
    base: opts.base,
    head: opts.branch,
    title: opts.title,
    body: opts.body,
  });
  return { url: created.data.html_url, number: created.data.number };
}

/**
 * A checklist of branch-protection changes implied by the CI check-name changes.
 * Empty when no matrix edits affect check names.
 */
function requiredCheckLines(plans: FilePlan[]): string[] {
  const impacts = plans
    .flatMap((p) => p.checkImpacts ?? [])
    .filter((i) => i.added.length || i.removed.length);
  if (impacts.length === 0) return [];

  const lines = [
    "### Required status checks",
    "",
    "This changes the names of matrix CI checks. If any are **required status checks** in",
    "branch protection, update them to match — otherwise this PR cannot merge and later PRs",
    "will be blocked by checks that no longer run:",
    "",
  ];
  const ctx = (job: string, value: string) => `\`${job} (${value})\``;
  for (const im of impacts) {
    const parts: string[] = [];
    if (im.simple) {
      if (im.removed.length)
        parts.push(
          `remove ${im.removed.map((v) => ctx(im.jobId, v)).join(", ")}`,
        );
      if (im.added.length)
        parts.push(`add ${im.added.map((v) => ctx(im.jobId, v)).join(", ")}`);
      lines.push(`- ${parts.join("; ")}`);
    } else {
      if (im.removed.length) parts.push(`removed ${im.removed.join(", ")}`);
      if (im.added.length) parts.push(`added ${im.added.join(", ")}`);
      lines.push(
        `- Job \`${im.jobId || "?"}\` (custom name or multi-dimension matrix — exact check ` +
          `names may differ): ${parts.join("; ")}. Update any required checks referencing those versions.`,
      );
    }
  }
  lines.push("");
  return lines;
}

/** Build the PR description from the commit groups, file plans, and the schedule source. */
export function buildPrBody(
  groups: CommitGroup[],
  plans: FilePlan[],
  scheduleUrl: string,
): string {
  const lines: string[] = [];
  lines.push(
    "Automated sync of Node.js versions against the official release schedule.",
  );
  lines.push("");

  const adds = groups.filter((g) => g.kind === "add");
  const drops = groups.filter((g) => g.kind === "drop");

  if (adds.length) {
    lines.push("### Added");
    for (const g of adds) lines.push(`- Node ${g.major}`);
    lines.push("");
  }
  if (drops.length) {
    lines.push("### Dropped");
    for (const g of drops) lines.push(`- Node ${g.major}`);
    lines.push("");
  }

  lines.push(...requiredCheckLines(plans));

  lines.push(`Source: ${scheduleUrl}`);
  return lines.join("\n");
}
