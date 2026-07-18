import * as core from "@actions/core";
import * as github from "@actions/github";
import { applyAll, reconcileRepo } from "./core.js";
import { classifyOverrides, discover, type Discovered } from "./discover.js";
import { prTitle } from "./reconcile.js";
import { buildSchedule, fetchSchedule } from "./schedule.js";
import { commitAndPush } from "./git.js";
import { buildPrBody, upsertPullRequest } from "./pr.js";

const DEFAULT_USER_NAME = "github-actions[bot]";
const DEFAULT_USER_EMAIL =
  "41898282+github-actions[bot]@users.noreply.github.com";

function parseNow(raw: string): Date {
  if (!raw.trim()) return new Date();
  const parsed = new Date(`${raw.trim()}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()))
    throw new Error(`Invalid \`now\` input: ${raw}`);
  return parsed;
}

function parsePaths(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function run(): Promise<void> {
  const token = core.getInput("token");
  const scheduleUrl = core.getInput("schedule-url");
  const branch = core.getInput("branch") || "chore/node-version-sync";
  const dryRun = core.getBooleanInput("dry-run");
  const now = parseNow(core.getInput("now"));
  const pathOverrides = parsePaths(core.getInput("paths"));

  const root = process.env.GITHUB_WORKSPACE || process.cwd();
  const { owner, repo } = github.context.repo;
  const defaultBranch = (
    github.context.payload.repository as { default_branch?: string } | undefined
  )?.default_branch;
  const base = core.getInput("base") || defaultBranch || "main";

  core.info(`Fetching Node.js release schedule from ${scheduleUrl}`);
  const schedule = buildSchedule(await fetchSchedule(scheduleUrl), now);
  core.info(
    `Active even (LTS) majors: ${schedule.activeEven.join(", ") || "none"}`,
  );

  const discovered: Discovered = pathOverrides.length
    ? classifyOverrides(pathOverrides)
    : await discover(root);

  const result = await reconcileRepo(discovered, schedule);

  core.setOutput("added", result.added.join(","));
  core.setOutput("removed", result.removed.join(","));

  if (result.groups.length === 0) {
    core.info("No Node version changes needed — everything is in sync.");
    core.setOutput("changed", "false");
    core.setOutput("pr-url", "");
    core.setOutput("pr-number", "");
    return;
  }

  core.setOutput("changed", "true");
  const title = prTitle(result.added, result.removed);
  core.info(`Planned PR title: ${title}`);
  for (const group of result.groups) {
    core.info(`  commit: ${group.message} (${group.plans.length} file(s))`);
  }

  if (dryRun) {
    core.info("dry-run enabled — computing changes without committing.");
    const final = applyAll(result);
    for (const [path, content] of final) {
      core.info(`--- ${path} (would become) ---\n${content}`);
    }
    core.setOutput("pr-url", "");
    core.setOutput("pr-number", "");
    return;
  }

  await commitAndPush(result, {
    cwd: root,
    branch,
    base,
    owner,
    repo,
    token,
    userName: DEFAULT_USER_NAME,
    userEmail: DEFAULT_USER_EMAIL,
  });

  const pr = await upsertPullRequest({
    token,
    owner,
    repo,
    base,
    branch,
    title,
    body: buildPrBody(result.groups, scheduleUrl),
  });

  core.info(`Pull request ready: ${pr.url}`);
  core.setOutput("pr-url", pr.url);
  core.setOutput("pr-number", String(pr.number));
}

run().catch((error) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});
