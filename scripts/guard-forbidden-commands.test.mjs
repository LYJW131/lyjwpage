import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { forbiddenReason } from "./guard-forbidden-commands.mjs";

const blocked = (command) => forbiddenReason(command) !== null;

test("各种写法的 wrangler deploy 与 deploy 脚本都拦", () => {
  for (const command of [
    "wrangler deploy",
    "npx wrangler deploy -c wrangler.toml",
    "npx wrangler@4 deploy",
    "pnpm --dir workers/core exec wrangler deploy -c wrangler.toml",
    "cd workers/ai && pnpm exec wrangler versions deploy",
    "CLOUDFLARE_ACCOUNT_ID=x ./node_modules/.bin/wrangler deploy",
    "echo $(wrangler deploy)",
    "pnpm --dir workers/collector run deploy",
    "npm run deploy",
    "yarn deploy",
  ]) {
    assert.ok(blocked(command), command);
  }
});

test("只读、预览与演练命令不拦", () => {
  for (const command of [
    "wrangler deploy --dry-run",
    "pnpm exec wrangler deployments list",
    "pnpm exec wrangler versions upload",
    "pnpm preview:deploy",
    "pnpm deploy ../out",
    'rg -n "wrangler deploy" AGENTS.md',
    "git commit -m '不手跑 wrangler deploy'",
    "git commit -F - <<'EOF'\ndocs: 拦下 wrangler deploy\n\nnpm run deploy\nEOF",
  ]) {
    assert.equal(forbiddenReason(command), null, command);
  }
});

test("强制提交本地凭据文件要拦，示例文件和普通 add 不拦", () => {
  assert.ok(blocked("git add -f workers/ai/.dev.vars"));
  assert.ok(blocked("git add --force .env.local"));
  assert.ok(blocked("git add -Af .dev.vars"));
  assert.equal(forbiddenReason("git add -f workers/core/.dev.vars.example"), null);
  assert.equal(forbiddenReason("git add .dev.vars"), null);
  assert.equal(forbiddenReason("git add -f src/env.ts"), null);
});

test("作为 PreToolUse 钩子：命中退出 2 并在 stderr 说明，其余静默放行", () => {
  const run = (command) =>
    spawnSync(process.execPath, ["scripts/guard-forbidden-commands.mjs"], {
      input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
      encoding: "utf8",
    });
  const hit = run("pnpm exec wrangler deploy");
  assert.equal(hit.status, 2);
  assert.match(hit.stderr, /禁区/);
  const miss = run("pnpm test");
  assert.equal(miss.status, 0);
  assert.equal(miss.stdout + miss.stderr, "");
});
