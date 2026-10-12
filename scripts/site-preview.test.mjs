import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { deploySitePreview } from "./deploy-site-preview.mjs";
import { sitePreviewConfig, sitePreviewManifest, sitePreviewName } from "./site-preview.mjs";

const commit = "a".repeat(40);
const branch = "feat/agent-status";
const apiOrigin = "https://feat-agent-status-api.lyjw.workers.dev";

const builtConfig = () => ({
  name: "site",
  main: "index.js",
  assets: { directory: "../client", binding: "ASSETS" },
  compatibility_date: "2026-10-08",
  compatibility_flags: ["nodejs_compat", "global_fetch_strictly_public"],
  no_bundle: true,
  exports: { RenderedSite: { type: "worker" } },
  images: { binding: "IMAGES" },
  vars: { SITE_ENV: "production", PUBLIC_BACKEND_URL: "https://api.homepage.lyjw.llc", SENTRY_DSN: "https://prod.example/dsn" },
  services: [{ binding: "PUBLIC_STATUS", service: "api", entrypoint: "PublicStatus" }],
  r2_buckets: [{ binding: "IMAGE_OBJECTS", bucket_name: "lyjw-homepage" }],
  kv_namespaces: [{ binding: "KV", id: "prod" }],
  d1_databases: [{ binding: "DB", database_id: "prod" }],
  durable_objects: { bindings: [{ name: "STATE", class_name: "StateHub" }] },
  migrations: [{ tag: "v1" }],
  routes: [{ pattern: "lyjw.me" }],
  secrets_store_secrets: [{ binding: "SECRET", store_id: "x", secret_name: "y" }],
  triggers: { crons: ["* * * * *"] },
  unknown_future_binding: { anything: true },
});

test("manifest rejects bad commits, main backends and non-branch origins", () => {
  assert.throws(() => sitePreviewManifest({ branch, commit: "ABC", backendUrl: apiOrigin }), /40-char/);
  assert.throws(() => sitePreviewManifest({ branch, commit: "z".repeat(40), backendUrl: apiOrigin }), /40-char/);
  assert.throws(() => sitePreviewManifest({ branch: "main", commit, backendUrl: apiOrigin }), /production/);
  assert.throws(() => sitePreviewManifest({ branch, commit, backendUrl: "https://api.homepage.lyjw.llc" }), /api Preview origin/);
  assert.throws(() => sitePreviewManifest({ branch, commit, backendUrl: null }), /api Preview origin/);
  assert.throws(() => sitePreviewManifest({ branch, commit, backendUrl: `${apiOrigin}/evil` }), /api Preview origin/);
  assert.throws(() => sitePreviewManifest({ branch, commit, backendUrl: "https://other-api.lyjw.workers.dev" }), /api Preview origin/);
});

test("manifest pins the branch's api preview origin", () => {
  assert.deepEqual(sitePreviewManifest({ branch, commit, backendUrl: apiOrigin }), {
    version: 1, mode: "preview", branch, commit, backendUrl: apiOrigin,
  });
  assert.throws(() => sitePreviewManifest({ branch, commit, backendUrl: "https://feat-agent-status-ai.lyjw.workers.dev" }), /api Preview origin/);
  assert.deepEqual(sitePreviewManifest({ branch: "", commit }), {
    version: 1, mode: "production", branch: "main", commit, backendUrl: null,
  });
  assert.equal(sitePreviewName(sitePreviewManifest({ branch, commit, backendUrl: apiOrigin })), "feat-agent-status");
});

function deployFixture({ manifest, built, env } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "site-preview-"));
  mkdirSync(path.join(root, "build/server"), { recursive: true });
  writeFileSync(path.join(root, "build/server/wrangler.json"), JSON.stringify(built ?? builtConfig()));
  writeFileSync(path.join(root, "build/site-preview.json"), JSON.stringify(manifest ?? sitePreviewManifest({ branch, commit, backendUrl: apiOrigin })));
  const calls = [];
  const spawn = (...args) => { calls.push(args); return { status: 0, stdout: "", stderr: "" }; };
  const run = () => deploySitePreview({ env: env ?? { WORKERS_CI_BRANCH: branch, WORKERS_CI_COMMIT_SHA: commit, SITE_PREVIEW_ACCESS_READY: "true" }, spawn, log: () => {}, root });
  return { root, calls, run };
}

test("deploy refuses production manifests, env mismatch and unasserted Access", () => {
  const env = { WORKERS_CI_BRANCH: branch, WORKERS_CI_COMMIT_SHA: commit, SITE_PREVIEW_ACCESS_READY: "true" };
  for (const [options, pattern] of [
    [{ manifest: sitePreviewManifest({ branch: "main", commit }), env }, /不是预览/],
    [{ env: { ...env, WORKERS_CI_COMMIT_SHA: "b".repeat(40) } }, /冻结记录不一致/],
    [{ env: { ...env, WORKERS_CI_BRANCH: "other" } }, /冻结记录不一致/],
    [{ env: { ...env, SITE_PREVIEW_ACCESS_READY: "" } }, /SITE_PREVIEW_ACCESS_READY/],
    [{ env: { WORKERS_CI_BRANCH: branch, WORKERS_CI_COMMIT_SHA: commit } }, /SITE_PREVIEW_ACCESS_READY/],
  ]) {
    const { calls, run } = deployFixture(options);
    assert.throws(run, pattern);
    assert.equal(calls.length, 0);
  }
});

test("deploy rejects a disk manifest that fails consumer validation", () => {
  const env = { WORKERS_CI_BRANCH: branch, WORKERS_CI_COMMIT_SHA: commit, SITE_PREVIEW_ACCESS_READY: "true" };
  for (const [manifest, pattern] of [
    [{ version: 1, mode: "preview", branch, commit: "z".repeat(40), backendUrl: apiOrigin }, /40-char/],
    [{ version: 1, mode: "preview", branch, commit, backendUrl: "https://api.homepage.lyjw.llc" }, /api Preview origin/],
    [{ version: 1, mode: "preview", branch, commit, backendUrl: "https://other-branch-api.lyjw.workers.dev" }, /api Preview origin/],
    [{ version: 2, mode: "preview", branch, commit, backendUrl: apiOrigin }, /版本/],
    [{ version: 1, mode: "preview", branch: "main", commit, backendUrl: apiOrigin }, /production/],
    [{ version: 1, mode: "preview", branch, commit, backendUrl: null }, /api Preview origin/],
    [{ version: 1, mode: "building", branch, commit, backendUrl: null }, /不是预览/],
  ]) {
    const { calls, run } = deployFixture({ manifest, env });
    assert.throws(run, pattern);
    assert.equal(calls.length, 0);
  }
});

test("deploy writes a whitelisted preview config, spawns the site preview name and removes the temp file", () => {
  const { root, calls, run } = deployFixture();
  run();
  assert.equal(calls.length, 1);
  const argv = calls[0][1];
  assert.deepEqual(argv.slice(1), ["preview", "--config", path.join(root, "build/server/wrangler.preview-site.json"), "--name", "feat-agent-status", "--worker-name", "site"]);

  const configPath = path.join(root, "build/server/wrangler.preview-site.json");
  assert.throws(() => readFileSync(configPath), /ENOENT/);

  const config = sitePreviewConfig(builtConfig(), sitePreviewManifest({ branch, commit, backendUrl: apiOrigin }));
  assert.equal(config.main, "index.js");
  assert.equal(config.workers_dev, false);
  assert.deepEqual(config.vars, {
    SITE_ENV: "preview",
    PUBLIC_BACKEND_URL: apiOrigin,
    R2_PUBLIC_BASE_URL: "https://lyjw.me/img",
  });
  assert.deepEqual(config.services, []);
  assert.deepEqual(config.r2_buckets, []);
  assert.deepEqual(config.kv_namespaces, []);
  assert.deepEqual(config.d1_databases, []);
  assert.deepEqual(config.durable_objects, { bindings: [] });
  assert.deepEqual(config.images, { binding: "IMAGES" });
  for (const key of ["migrations", "routes", "secrets_store_secrets", "triggers", "unknown_future_binding"]) {
    assert.equal(config[key], undefined, key);
  }
  assert.deepEqual(config.previews.vars, config.vars);
  assert.deepEqual(config.previews.services, []);
  assert.deepEqual(config.previews.durable_objects, { bindings: [] });
  assert.deepEqual(config.previews.images, { binding: "IMAGES" });
});

test("production config keeps preview_urls on, since every production deploy rewrites the Worker-wide Preview URL switch", () => {
  const production = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(production, /"preview_urls":\s*true/);
});
