import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { forbiddenReason } from "./guard-forbidden-commands.mjs";

const blocked = (command) => forbiddenReason(command) !== null;

test("各种写法的 wrangler deploy、cf deploy 与 deploy 脚本都拦", () => {
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
    "cf deploy",
    "npx cf deploy --prebuilt --mode production",
    "pnpm exec cf deploy",
    "cloudflare deploy",
    "cf workers deployments create --worker core",
    "cf workers triggers deploy",
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
    "cf deploy --dry-run",
    "cf previews deploy feat-x",
    "cf workers deployments list",
    "cf workers versions create",
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

test("改提交身份、关签名要拦", () => {
  for (const command of [
    "GIT_COMMITTER_NAME=Claude GIT_COMMITTER_EMAIL=noreply@anthropic.com git commit -q -F - <<'EOF'\nfix: x\nEOF",
    "GIT_AUTHOR_EMAIL=noreply@anthropic.com git merge origin/main",
    "export GIT_COMMITTER_EMAIL=noreply@anthropic.com && git commit -m x",
    "env GIT_COMMITTER_NAME=Claude git commit -m x",
    "git -c user.email=noreply@anthropic.com commit -m x",
    "git -c commit.gpgsign=false commit -m x",
    "git commit --no-gpg-sign -m x",
    'git commit --author="Claude <noreply@anthropic.com>" -m x',
    "git config user.email noreply@anthropic.com",
    "git config --global user.name Claude",
    "git config --unset commit.gpgsign",
    "git config set user.email noreply@anthropic.com",
    "git config --file .git/config user.email noreply@anthropic.com",
    "git config --type string user.name Claude",
    "EMAIL=noreply@anthropic.com git --config-env=user.email=EMAIL commit -m x",
    "git -C /tmp/repo commit --author=Claude -m x",
  ]) {
    assert.ok(blocked(command), command);
  }
});

test("读取身份、普通提交和提交信息里的署名不拦", () => {
  for (const command of [
    "git config user.email",
    "git config --get user.name",
    "git config --list | grep user",
    "env | grep -E '^GIT_'",
    "git log --format='%an %cn'",
    "git commit -F - <<'EOF'\nfix: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nGIT_COMMITTER_NAME=Claude\nEOF",
    "rg -n 'GIT_COMMITTER_NAME=' scripts",
    "git merge --no-edit origin/main",
    "git log --author=Claude --oneline",
    "git shortlog -sn --author=Claude",
    "git config --get-regexp user.email '.*'",
    "git config get user.email",
    "git config --file .git/config user.email",
  ]) {
    assert.equal(forbiddenReason(command), null, command);
  }
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
