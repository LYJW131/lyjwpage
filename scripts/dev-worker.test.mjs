import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { remoteAiEnabled, withoutAiBinding } from "./dev-worker.mjs";

test("离线配置只去掉 [ai] 段，其余绑定原样保留", () => {
  for (const file of ["workers/api/wrangler.test.toml", "workers/ai/wrangler.test.toml"]) {
    const source = fs.readFileSync(file, "utf8");
    const offline = withoutAiBinding(source);
    assert.match(source, /^\[ai\]$/m, `${file} 没有 [ai] 段，去掉逻辑已无对象`);
    assert.doesNotMatch(offline, /^\[ai\]$|binding = "AI"/m);
    assert.equal(offline.split("\n").filter((line) => line.startsWith("[")).length,
      source.split("\n").filter((line) => line.startsWith("[")).length - 1);
  }
});

test("有令牌或 wrangler 登录才连远程 AI，DEV_WORKER_AI 可强制", () => {
  const none = () => false;
  assert.equal(remoteAiEnabled({}, "/home/x", none), false);
  assert.equal(remoteAiEnabled({ CLOUDFLARE_API_TOKEN: "t" }, "/home/x", none), true);
  assert.equal(remoteAiEnabled({}, "/home/x", (file) => file === "/home/x/.config/.wrangler/config/default.toml"), true);
  assert.equal(remoteAiEnabled({ DEV_WORKER_AI: "off", CLOUDFLARE_API_TOKEN: "t" }, "/home/x", none), false);
  assert.equal(remoteAiEnabled({ DEV_WORKER_AI: "remote" }, "/home/x", none), true);
});
