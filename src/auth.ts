import { createSign } from "node:crypto";
import * as core from "@actions/core";
import * as github from "@actions/github";
import type { Octokit } from "./pr.js";

export interface AuthInputs {
  /** A PAT or GITHUB_TOKEN. Used when App credentials are not supplied. */
  token: string;
  /** GitHub App id. When set together with privateKey, App auth is used. */
  appId: string;
  /** GitHub App private key (PEM). */
  privateKey: string;
  owner: string;
  repo: string;
}

export interface ResolvedAuth {
  octokit: Octokit;
  via: "app" | "token";
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * Build a GitHub App JWT (RS256), signed with the App private key. `iat` is
 * backdated 60s to tolerate clock drift; `exp` is well within the 10-minute cap.
 */
export function makeAppJwt(
  appId: string,
  privateKey: string,
  nowSec: number,
): string {
  const header = { alg: "RS256", typ: "JWT" };
  const payload = { iat: nowSec - 60, exp: nowSec + 9 * 60, iss: appId };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createSign("RSA-SHA256")
    .update(signingInput)
    .sign(privateKey);
  return `${signingInput}.${base64url(signature)}`;
}

/** Mint a short-lived installation access token for the repo the App is installed on. */
async function installationToken(inputs: AuthInputs): Promise<string> {
  const jwt = makeAppJwt(
    inputs.appId,
    inputs.privateKey,
    Math.floor(Date.now() / 1000),
  );
  const headers = {
    Authorization: `Bearer ${jwt}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "keep-node-current",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  const instRes = await fetch(
    `https://api.github.com/repos/${inputs.owner}/${inputs.repo}/installation`,
    { headers },
  );
  if (!instRes.ok) {
    throw new Error(
      `GitHub App is not installed on ${inputs.owner}/${inputs.repo} (or the app id/key is wrong): ${instRes.status} ${instRes.statusText}`,
    );
  }
  const installation = (await instRes.json()) as { id: number };

  const tokRes = await fetch(
    `https://api.github.com/app/installations/${installation.id}/access_tokens`,
    {
      method: "POST",
      headers,
    },
  );
  if (!tokRes.ok) {
    throw new Error(
      `Failed to create App installation token: ${tokRes.status} ${tokRes.statusText}`,
    );
  }
  const token = ((await tokRes.json()) as { token: string }).token;
  core.setSecret(token); // never let the minted token appear in logs
  return token;
}

/**
 * Resolve the octokit client to use. Prefers GitHub App auth when both `appId` and
 * `privateKey` are provided (short-lived installation token, nothing to rotate);
 * otherwise falls back to the supplied `token`.
 */
export async function resolveOctokit(
  inputs: AuthInputs,
): Promise<ResolvedAuth> {
  const hasApp = Boolean(inputs.appId) && Boolean(inputs.privateKey);
  if (Boolean(inputs.appId) !== Boolean(inputs.privateKey)) {
    core.warning(
      "Both `app-id` and `private-key` are required for GitHub App auth; falling back to `token`.",
    );
  }
  if (hasApp) {
    const token = await installationToken(inputs);
    return { octokit: github.getOctokit(token), via: "app" };
  }
  return { octokit: github.getOctokit(inputs.token), via: "token" };
}
