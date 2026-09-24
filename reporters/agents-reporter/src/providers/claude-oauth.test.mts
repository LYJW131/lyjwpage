import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import { parseClaudeOAuthClients, scanClaudeOAuthClient } from "../../dist/claude-oauth-client.js";
import { claudeAccessExpired, refreshClaudeIfDue, refreshClaudeOauth } from "../../dist/claude-oauth.js";
import { config } from "../../dist/config.js";
import { collectAgents } from "../../dist/limits.js";

const clientId = "11111111-2222-4333-8444-555555555555";
const tokenUrl = "https://platform.claude.com/v1/oauth/token";
const embeddedConfig = `{BASE_API_URL:"https://api.anthropic.com",TOKEN_URL:"${tokenUrl}",CLIENT_ID:"${clientId}",DESIGN_CLIENT_ID:"99999999-2222-4333-8444-555555555555",OAUTH_FILE_SUFFIX:""}`;

async function fixture(t: TestContext) {
  const home = await mkdtemp(path.join(os.tmpdir(), "claude-oauth-test-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const binary = path.join(home, "claude");
  await writeFile(binary, embeddedConfig);
  const file = path.join(home, ".claude", ".credentials.json");
  await mkdir(path.dirname(file));
  const original = {
    mcpOAuth: { untouched: true },
    claudeAiOauth: {
      accessToken: "old-access", refreshToken: "old-refresh", expiresAt: Date.now() - 1,
      scopes: ["user:profile", "user:inference"],
      subscriptionType: "max", rateLimitTier: "default_claude_max_5x",
    },
  };
  await writeFile(file, JSON.stringify(original), { mode: 0o600 });
  const saved = { claudeBin: config.claudeBin, home: config.home, agentIds: config.agentIds, claudeOAuth: config.claudeOAuth };
  Object.assign(config, { claudeBin: binary, home, agentIds: ["claude"], claudeOAuth: { tokenUrl: "", clientId: "" } });
  t.after(() => Object.assign(config, saved));
  return { home, file, original, binary };
}

test("扫描只认生产配置里的 Claude Code 客户端，不认 Design 或 staging", () => {
  assert.deepEqual(parseClaudeOAuthClients(embeddedConfig), [{ tokenUrl, clientId }]);
  assert.deepEqual(parseClaudeOAuthClients(embeddedConfig.replace('OAUTH_FILE_SUFFIX:""', 'OAUTH_FILE_SUFFIX:"-staging"')), []);
  assert.deepEqual(parseClaudeOAuthClients(embeddedConfig.replace('CLIENT_ID:', 'OTHER_CLIENT_ID:')), []);
  assert.deepEqual(parseClaudeOAuthClients(embeddedConfig.replace('platform.claude.com', 'example.invalid')), []);
});

test("扫描跨读取块的配置并去重，遇到多个生产客户端拒绝猜测", async (t) => {
  const { binary } = await fixture(t);
  await writeFile(binary, Buffer.concat([Buffer.alloc(1024 * 1024 - 40), Buffer.from(embeddedConfig.repeat(2))]));
  assert.deepEqual(await scanClaudeOAuthClient(binary), { tokenUrl, clientId });
  await writeFile(binary, embeddedConfig + embeddedConfig.replace(clientId, "22222222-2222-4333-8444-555555555555"));
  await assert.rejects(scanClaudeOAuthClient(binary), /无法唯一识别/);
});

test("自动发现配置、发送 JSON 和原 scopes，并将轮换 token 原子保存", async (t) => {
  const { home, file, original } = await fixture(t);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls++;
    assert.equal(url, tokenUrl);
    assert.equal(init.headers["Content-Type"], "application/json");
    assert.equal(init.redirect, "error");
    assert.deepEqual(JSON.parse(init.body), {
      grant_type: "refresh_token", refresh_token: "old-refresh", client_id: clientId,
      scope: "user:profile user:inference",
    });
    return Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 28800, scope: "user:profile user:inference" });
  });
  await Promise.all([refreshClaudeOauth(home), refreshClaudeOauth(home)]);
  assert.equal(calls, 1);
  const saved = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(saved.mcpOAuth, original.mcpOAuth);
  assert.equal(saved.claudeAiOauth.subscriptionType, "max");
  assert.equal(saved.claudeAiOauth.accessToken, "new-access");
  assert.equal(saved.claudeAiOauth.refreshToken, "new-refresh");
  assert.ok(saved.claudeAiOauth.expiresAt > Date.now() + 28_790_000);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  await refreshClaudeIfDue(home);
  assert.equal(calls, 1);
});

test("到期前自动续期；上游不返回 refresh_token 时保留旧值", async (t) => {
  const { home, file } = await fixture(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({ access_token: "new-access", expires_in: 28800 }));
  await refreshClaudeIfDue(home);
  const saved = JSON.parse(await readFile(file, "utf8"));
  assert.equal(saved.claudeAiOauth.refreshToken, "old-refresh");
  assert.equal(saved.claudeAiOauth.accessToken, "new-access");
  assert.equal(claudeAccessExpired({ expiresAt: Date.now() + 4 * 60_000 }), true);
  assert.equal(claudeAccessExpired({ expiresAt: Date.now() + 6 * 60_000 }), false);
});

test("刷新失败或响应缺少有效期时不覆盖原凭据，不泄露响应内容", async (t) => {
  const { home, file } = await fixture(t);
  const before = await readFile(file, "utf8");
  for (const response of [
    Response.json({ error: "invalid_grant", private: "do-not-log" }, { status: 400 }),
    Response.json({ access_token: "do-not-save", expires_in: -1 }),
  ]) {
    t.mock.method(globalThis, "fetch", async () => response);
    await assert.rejects(refreshClaudeOauth(home), (error: Error) => /HTTP/.test(error.message) && !error.message.includes("do-not"));
    assert.equal(await readFile(file, "utf8"), before);
  }
});

test("usage 回 401 后续期一次，再用新 access token 读取限额", async (t) => {
  await fixture(t);
  let usageCalls = 0;
  let refreshCalls = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (url === tokenUrl) {
      refreshCalls++;
      return Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 28800 });
    }
    assert.equal(url, "https://api.anthropic.com/api/oauth/usage");
    usageCalls++;
    if (usageCalls === 1) return new Response(null, { status: 401 });
    assert.equal(init.headers.Authorization, "Bearer new-access");
    return Response.json({ five_hour: { utilization: 25 }, seven_day: { utilization: 10 } });
  });
  const rows = await collectAgents();
  assert.equal(refreshCalls, 1);
  assert.equal(usageCalls, 2);
  assert.equal(rows[0]?.limitsError, null);
  assert.equal(rows[0]?.limits[0]?.usedPercent, 25);
});
