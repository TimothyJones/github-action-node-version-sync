import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { reconcileRepo } from "../src/core.js";
import { discover } from "../src/discover.js";
import { commitAndPush } from "../src/git.js";
import { buildSchedule, type RawSchedule } from "../src/schedule.js";

const rawSchedule = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/schedule.json", import.meta.url)),
    "utf8",
  ),
) as RawSchedule;
const schedule = buildSchedule(rawSchedule, new Date("2025-07-01T00:00:00Z"));
const fixtureRepo = fileURLToPath(new URL("./fixtures/repo", import.meta.url));

const scratch = mkdtempSync(join(tmpdir(), "nvs-git-"));
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("commitAndPush", () => {
  it("creates one commit per version change and pushes the branch", async () => {
    const origin = join(scratch, "origin.git");
    const work = join(scratch, "work");
    mkdirSync(origin, { recursive: true });
    git(origin, "init", "--bare", "--initial-branch=main");

    // Seed the working repo from the fixture and push an initial main.
    mkdirSync(work, { recursive: true });
    git(work, "init", "--initial-branch=main");
    git(work, "config", "user.name", "seed");
    git(work, "config", "user.email", "seed@example.com");
    cpSync(fixtureRepo, work, { recursive: true });
    git(work, "add", "-A");
    git(work, "commit", "-m", "chore: initial");
    git(work, "remote", "add", "origin", origin);
    git(work, "push", "origin", "main");

    const discovered = await discover(work);
    const result = await reconcileRepo(discovered, schedule);

    await commitAndPush(result, {
      cwd: work,
      branch: "chore/node-version-sync",
      base: "main",
      owner: "acme",
      repo: "widgets",
      token: "unused",
      userName: "github-actions[bot]",
      userEmail: "bot@example.com",
      remoteUrl: origin,
    });

    // The branch exists on origin with the three expected commits, newest first.
    const log = git(
      origin,
      "log",
      "chore/node-version-sync",
      "--format=%s",
    ).split("\n");
    expect(log.slice(0, 3)).toEqual([
      "feat!: Drop support for node version 18",
      "feat: Add support for node version 24",
      "feat: Add support for node version 22",
    ]);

    // Each commit is scoped to only its version's edits.
    const dropDiff = git(
      origin,
      "show",
      "--name-only",
      "--format=",
      "chore/node-version-sync",
    );
    expect(dropDiff).toContain(".nvmrc");
    expect(dropDiff).toContain("package.json");

    // Final tree on the branch reflects all reconciled changes.
    const finalNvmrc = git(origin, "show", "chore/node-version-sync:.nvmrc");
    expect(finalNvmrc).toBe("24");
  });
});
