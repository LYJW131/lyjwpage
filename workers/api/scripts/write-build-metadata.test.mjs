import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { writeBuildMetadata } from "./write-build-metadata.mjs";
import { buildCommit } from "../src/build-metadata.ts";

test("未使用生产 alias 的本地代码不带构建提交", () => {
  assert.equal(buildCommit, undefined);
});

async function emittedCommit(env, destination) {
  writeBuildMetadata(env, destination);
  const source = readFileSync(destination, "utf8");
  return (await import(`data:text/javascript,${encodeURIComponent(source)}`)).buildCommit;
}

test("构建提交只采用 Workers Builds 的完整 SHA", async (t) => {
  const temporary = mkdtempSync(join(tmpdir(), "api-build-metadata-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const destination = join(temporary, ".wrangler", "build-metadata.mjs");
  const sha = "0123456789abcdef0123456789abcdef01234567";
  assert.equal(await emittedCommit({ WORKERS_CI_COMMIT_SHA: ` ${sha.toUpperCase()}\n` }, destination), sha);
  assert.equal(await emittedCommit({ GITHUB_SHA: sha, VERCEL_GIT_COMMIT_SHA: sha }, destination), undefined);
});

test("缺失或无效 SHA 清除已生成的构建提交", async (t) => {
  const temporary = mkdtempSync(join(tmpdir(), "api-build-metadata-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const destination = join(temporary, "build-metadata.mjs");
  const sha = "0123456789abcdef0123456789abcdef01234567";
  for (const value of [undefined, "", "   ", "0123456", "g".repeat(40), `${sha};throw Error('injected')`]) {
    assert.equal(await emittedCommit({ WORKERS_CI_COMMIT_SHA: sha }, destination), sha);
    assert.equal(await emittedCommit({ WORKERS_CI_COMMIT_SHA: value }, destination), undefined);
  }
});
