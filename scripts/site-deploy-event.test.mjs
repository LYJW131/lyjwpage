import assert from "node:assert/strict";
import test from "node:test";

import { siteDeploymentSha } from "./site-deploy-event.mjs";

const SHA = "f72dd525b8c1befb018b76ca041a9a6d0c27ce84";

function siteCheck(overrides = {}) {
  return {
    app: { slug: "cloudflare-workers-and-pages" },
    name: "Workers Builds: site",
    conclusion: "success",
    head_sha: SHA,
    check_suite: { head_branch: "main" },
    ...overrides,
  };
}

test("可信的 main site 构建检查产出提交 SHA", () => {
  assert.equal(siteDeploymentSha("check_run", { check_run: siteCheck() }), SHA);
});

test("其他 Worker、失败检查、github-actions 应用、非 main 分支都不算数", () => {
  assert.equal(siteDeploymentSha("check_run", { check_run: siteCheck({ name: "Workers Builds: api" }) }), null);
  assert.equal(siteDeploymentSha("check_run", { check_run: siteCheck({ conclusion: "failure" }) }), null);
  assert.equal(siteDeploymentSha("check_run", { check_run: siteCheck({ app: { slug: "github-actions" } }) }), null);
  assert.equal(siteDeploymentSha("check_run", { check_run: siteCheck({ check_suite: { head_branch: "devin/cloudflare-react-router" } }) }), null);
});

test("workflow_dispatch 空输入回落到默认 SHA，显式输入须是完整 SHA", () => {
  assert.equal(siteDeploymentSha("workflow_dispatch", { inputs: {} }, SHA), SHA);
  assert.equal(siteDeploymentSha("workflow_dispatch", { inputs: { commit: "" } }, SHA), SHA);
  const manual = "a".repeat(40);
  assert.equal(siteDeploymentSha("workflow_dispatch", { inputs: { commit: manual } }, SHA), manual);
});

test("畸形 SHA 直接抛错", () => {
  assert.throws(
    () => siteDeploymentSha("check_run", { check_run: siteCheck({ head_sha: "not-a-sha" }) }),
    /complete production commit SHA/,
  );
  assert.throws(
    () => siteDeploymentSha("workflow_dispatch", { inputs: { commit: "abc123" } }, SHA),
    /complete production commit SHA/,
  );
});

test("deployment_status 等其他事件返回 null", () => {
  assert.equal(
    siteDeploymentSha("deployment_status", { deployment_status: { state: "success" } }),
    null,
  );
  assert.equal(siteDeploymentSha("push", {}), null);
});
