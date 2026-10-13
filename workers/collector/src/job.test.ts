import assert from "node:assert/strict";
import test from "node:test";

import type { Env } from "./env";
import { explain, ok, resetSkipWarningsForTests, setting, settings, skipMissing } from "./job";

test("ok 只在有内容时带 detail", () => {
  assert.deepEqual(ok(), { status: "ok" });
  assert.deepEqual(ok("changed"), { status: "ok", detail: "changed" });
});

test("setting 去首尾空白，空白串与非字符串值都算没配", () => {
  const env = {
    GITHUB_TOKEN: "  ghp_abc  ",
    SENTRY_API_TOKEN: "   ",
    CLOUDFLARE_ACCOUNT_ID: 42 as unknown as string,
    LAG: {} as Env["LAG"],
  } as Env;
  assert.equal(setting(env, "GITHUB_TOKEN"), "ghp_abc");
  assert.equal(setting(env, "SENTRY_API_TOKEN"), undefined);
  assert.equal(setting(env, "CLOUDFLARE_ACCOUNT_ID"), undefined);
  assert.equal(setting(env, "LAG"), undefined);
  assert.equal(setting(env, "PAGESPEED_API_KEY"), undefined);
});

test("settings 按声明顺序报缺失，值都去过空白", () => {
  const env = { CLOUDFLARE_METRICS_TOKEN: " t ", GITHUB_TOKEN: "g" } as Env;
  assert.deepEqual(settings(env, ["CLOUDFLARE_METRICS_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "GITHUB_TOKEN"]), {
    missing: ["CLOUDFLARE_ACCOUNT_ID"],
  });
  assert.deepEqual(settings(env, ["CLOUDFLARE_METRICS_TOKEN", "GITHUB_TOKEN"]), {
    values: { CLOUDFLARE_METRICS_TOKEN: "t", GITHUB_TOKEN: "g" },
  });
  assert.deepEqual(settings({} as Env, ["GITHUB_TOKEN", "SENTRY_API_TOKEN"]), {
    missing: ["GITHUB_TOKEN", "SENTRY_API_TOKEN"],
  });
});

test("skipMissing 同一任务只 warn 一次，detail 列出全部缺口", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  resetSkipWarningsForTests();
  assert.deepEqual(skipMissing("github-chart", ["GITHUB_TOKEN"]), { status: "skipped", detail: "missing GITHUB_TOKEN" });
  assert.deepEqual(skipMissing("github-chart", ["GITHUB_TOKEN"]), { status: "skipped", detail: "missing GITHUB_TOKEN" });
  assert.equal(warn.mock.callCount(), 1, "同一任务重复跳过不重复告警");
  const logged = JSON.parse(String(warn.mock.calls[0].arguments[0]));
  assert.equal(logged.event, "collector-skip");
  assert.equal(logged.job, "github-chart");
  assert.deepEqual(logged.missing, ["GITHUB_TOKEN"]);

  assert.deepEqual(skipMissing("pagespeed", ["PAGESPEED_API_KEY"]), { status: "skipped", detail: "missing PAGESPEED_API_KEY" });
  assert.equal(warn.mock.callCount(), 2, "换一个任务仍要告警");

  resetSkipWarningsForTests();
  skipMissing("github-chart", ["GITHUB_TOKEN"]);
  assert.equal(warn.mock.callCount(), 3);
});

test("explain 取 Error 的 message，其余按字符串展开", () => {
  assert.equal(explain(new Error("boom")), "boom");
  assert.equal(explain("plain"), "plain");
  assert.equal(explain(404), "404");
});
