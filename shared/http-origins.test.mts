import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isAllowedOrigin, isForeignOrigin, requestOrigin } from "@shared/http-origins";

const env = { ALLOWED_ORIGINS: "https://lyjw131.com,https://lyjw.me,https://*.lyjw.workers.dev" };

function request(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

test("同源 GET 不带 Origin 时按请求自己的源校验", () => {
  const sameOrigin = request("https://lyjw.me/api/musickit/token", { "Sec-Fetch-Site": "same-origin" });
  assert.equal(requestOrigin(sameOrigin), "https://lyjw.me");
  assert.equal(isAllowedOrigin(sameOrigin, env), true);

  const apiDomain = request("https://api.homepage.lyjw.llc/api/musickit/token", { "Sec-Fetch-Site": "same-origin" });
  assert.equal(isAllowedOrigin(apiDomain, env), false, "请求自己的源不在名单里照样拒绝");
});

test("不带 Origin 又不是同源请求的一律拒绝", () => {
  for (const site of [null, "same-site", "cross-site", "none"]) {
    const headers: Record<string, string> = site ? { "Sec-Fetch-Site": site } : {};
    const bare = request("https://lyjw.me/api/chat/usage", headers);
    assert.equal(requestOrigin(bare), null, String(site));
    assert.equal(isAllowedOrigin(bare, env), false, String(site));
  }
});

test("带了 Origin 就只看 Origin", () => {
  const cross = request("https://lyjw.me/api/chat/usage", { Origin: "https://lyjw131.com", "Sec-Fetch-Site": "cross-site" });
  assert.equal(requestOrigin(cross), "https://lyjw131.com");
  assert.equal(isAllowedOrigin(cross, env), true);

  const foreign = request("https://lyjw.me/api/chat/usage", { Origin: "https://evil.example", "Sec-Fetch-Site": "same-origin" });
  assert.equal(isAllowedOrigin(foreign, env), false);
});

test("isForeignOrigin 只拦带了且不在名单里的 Origin", () => {
  assert.equal(isForeignOrigin(request("https://lyjw.me/api/status/server"), env), false);
  assert.equal(isForeignOrigin(request("https://lyjw.me/api/status/server", { Origin: "https://lyjw131.com" }), env), false);
  assert.equal(isForeignOrigin(request("https://lyjw.me/api/status/server", { Origin: "http://localhost:3211" }), env), false);
  assert.equal(isForeignOrigin(request("https://lyjw.me/api/status/server", { Origin: "https://lyjwpage-abc.vercel.app" }), env), true);
});

test("site、core、ai、collector 的生产来源名单一致：站点回可滞后视图、后端回其余视图，名单不同就会一半放行一半 403", () => {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const production = (path: string) => read(path).split(/^\[previews/m)[0].match(/^ALLOWED_ORIGINS = "([^"]*)"$/m)?.[1];
  const site = read("wrangler.jsonc").match(/"ALLOWED_ORIGINS":\s*"([^"]*)"/)?.[1];
  assert.ok(site);
  assert.equal(production("workers/core/wrangler.toml"), site);
  assert.equal(production("workers/ai/wrangler.toml"), site);
  assert.equal(production("workers/collector/wrangler.toml"), site);
});
