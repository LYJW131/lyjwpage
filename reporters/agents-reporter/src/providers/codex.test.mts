import assert from "node:assert/strict";
import test from "node:test";

import { normalizeCodexUsage, rowFromCodexUsage } from "../../dist/providers/codex.js";

test("Codex Spark 窗口按时长归位，槽位反了也能认", () => {
  const node = normalizeCodexUsage({
    rate_limit: {
      primary_window: { used_percent: 12, limit_window_seconds: 18000, reset_at: 11111 },
      secondary_window: { used_percent: 30, limit_window_seconds: 604800, reset_at: 99999 },
    },
    additional_rate_limits: [
      {
        limit_name: "codex spark model",
        rate_limit: {
          primary_window: { used_percent: 18, limit_window_seconds: 604800, reset_at: 33333 },
          secondary_window: { used_percent: 4, limit_window_seconds: 18000, reset_at: 22222 },
        },
      },
    ],
  });
  assert.deepEqual(node.primary_window, {
    used_percent: 12,
    limit_window_seconds: 18000,
    reset_at: 11111,
  });
  assert.deepEqual(node.secondary_window, {
    used_percent: 30,
    limit_window_seconds: 604800,
    reset_at: 99999,
  });
  assert.deepEqual(node.spark_primary_window, {
    used_percent: 4,
    limit_window_seconds: 18000,
    reset_at: 22222,
  });
  assert.deepEqual(node.spark_secondary_window, {
    used_percent: 18,
    limit_window_seconds: 604800,
    reset_at: 33333,
  });
});

test("Codex 用量百分比先四舍五入再交给窗口", () => {
  const node = normalizeCodexUsage({
    rate_limit: {
      primary_window: { used_percent: 12.4, limit_window_seconds: 18000, reset_at: 100 },
      secondary_window: { used_percent: 30.6, limit_window_seconds: 604800, reset_at: 200 },
    },
  });
  assert.equal((node.primary_window as { used_percent: number }).used_percent, 12);
  assert.equal((node.secondary_window as { used_percent: number }).used_percent, 31);
});

test("rowFromCodexUsage 把 prolite 收成 Pro Lite", () => {
  const row = rowFromCodexUsage(
    {
      rate_limit: {
        primary_window: { used_percent: 10, limit_window_seconds: 18000, reset_at: 1757100000 },
        secondary_window: { used_percent: 40, limit_window_seconds: 604800, reset_at: 1757700000 },
      },
    },
    "prolite",
  );
  assert.deepEqual(row.plan, { tier: "prolite", label: "Pro Lite" });
  assert.equal(row.limits[0]?.key, "codex.primary");
  assert.equal(row.limits[0]?.windowMinutes, 300);
  assert.equal(row.limits[1]?.windowMinutes, 10080);
});

test("fetchCodex 遇 401 先刷新 token 再取一次，套餐按新 token 算", async (t) => {
  const { mkdtemp, readFile, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { fetchCodex } = await import("../../dist/providers/codex.js");
  const jwt = (claims: Record<string, unknown>) =>
    `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
  const farFuture = Math.floor(Date.now() / 1000) + 86_400;
  const auth = (plan: string) => jwt({ exp: farFuture, "https://api.openai.com/auth": { chatgpt_plan_type: plan } });
  const home = await mkdtemp(path.join(tmpdir(), "codex-"));
  const oldToken = auth("pro");
  const newToken = auth("plus");
  await writeFile(
    path.join(home, "auth.json"),
    JSON.stringify({ tokens: { access_token: oldToken, refresh_token: "r1" }, last_refresh: new Date().toISOString() }),
  );
  process.env.CODEX_HOME = home;
  const seen: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    seen.push(url);
    if (url.includes("oauth/token")) {
      return Response.json({ access_token: newToken, refresh_token: "r2" });
    }
    const bearer = (init.headers as Record<string, string>).Authorization;
    if (bearer !== `Bearer ${newToken}`) return new Response(null, { status: 401 });
    return Response.json({
      rate_limit: {
        primary_window: { used_percent: 10, limit_window_seconds: 18000, reset_at: 1757100000 },
        secondary_window: { used_percent: 40, limit_window_seconds: 604800, reset_at: 1757700000 },
      },
    });
  });

  const row = await fetchCodex();
  delete process.env.CODEX_HOME;

  assert.equal(seen.length, 3);
  assert.equal(row?.limitsError, null);
  assert.equal(row?.limits.length, 2);
  assert.equal(row?.plan?.label, "Plus");
  const saved = JSON.parse(await readFile(path.join(home, "auth.json"), "utf8"));
  assert.equal(saved.tokens.refresh_token, "r2");
});
