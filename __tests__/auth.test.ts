import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { makeAppJwt, resolveOctokit } from "../src/auth.js";

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

function decodeSegment(seg: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(seg, "base64url").toString("utf8"));
}

describe("makeAppJwt", () => {
  const now = 1_700_000_000;
  const jwt = makeAppJwt("12345", pem, now);
  const [header, payload, signature] = jwt.split(".");

  it("produces an RS256 JWT with the expected claims", () => {
    expect(decodeSegment(header)).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = decodeSegment(payload);
    expect(claims.iss).toBe("12345");
    expect(claims.iat).toBe(now - 60); // backdated for clock drift
    expect(claims.exp).toBe(now + 9 * 60); // within GitHub's 10-minute cap
  });

  it("is signed with the private key", () => {
    const verifier = createVerify("RSA-SHA256").update(`${header}.${payload}`);
    expect(
      verifier.verify(publicKey, Buffer.from(signature, "base64url")),
    ).toBe(true);
  });
});

describe("resolveOctokit", () => {
  it("uses token auth when App credentials are absent", async () => {
    const { via, octokit } = await resolveOctokit({
      token: "ghp_test",
      appId: "",
      privateKey: "",
      owner: "acme",
      repo: "widgets",
    });
    expect(via).toBe("token");
    expect(octokit.rest.pulls).toBeDefined();
  });
});
