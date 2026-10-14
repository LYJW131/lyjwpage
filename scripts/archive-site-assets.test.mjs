import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ARCHIVE_BUCKET, archivePlan, archiveSiteAssets } from "./archive-site-assets.mjs";

function assetsDir(names) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asset-archive-"));
  for (const name of names) fs.writeFileSync(path.join(dir, name), `/* ${name} */`);
  return dir;
}

const quiet = { log() {}, warn() {} };

test("存档清单跳过 sourcemap，不认识的文件单列", () => {
  const { files, skipped } = archivePlan(assetsDir(["root-a.css", "page-b.js", "page-b.js.map", "notes.txt"]));
  assert.deepEqual(files.map((f) => [f.name, f.key, f.contentType]), [
    ["page-b.js", "site-assets/page-b.js", "text/javascript; charset=utf-8"],
    ["root-a.css", "site-assets/root-a.css", "text/css; charset=utf-8"],
  ]);
  assert.deepEqual(skipped, ["notes.txt"]);
});

test("逐个 PUT 到存档桶，5xx 重试，4xx 不重试且只告警", async () => {
  const dir = assetsDir(["root-a.css", "page-b.js", "card-c.js"]);
  const calls = [];
  let flaky = 1;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/page-b.js") && flaky-- > 0) return new Response("boom", { status: 502 });
    if (url.endsWith("/card-c.js")) return new Response("denied", { status: 403 });
    return new Response("{}", { status: 200 });
  };
  const result = await archiveSiteAssets({ dir, env: { CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "acc" }, fetchImpl, log: quiet });
  assert.equal(result.uploaded, 2);
  assert.deepEqual(result.failed.map((f) => f.name), ["card-c.js"]);
  assert.equal(calls.filter((c) => c.url.endsWith("/card-c.js")).length, 1);
  assert.equal(calls.filter((c) => c.url.endsWith("/page-b.js")).length, 2);
  const css = calls.find((c) => c.url.endsWith("/root-a.css"));
  assert.equal(css.url, `https://api.cloudflare.com/client/v4/accounts/acc/r2/buckets/${ARCHIVE_BUCKET}/objects/site-assets/root-a.css`);
  assert.equal(css.init.method, "PUT");
  assert.equal(css.init.headers["Content-Type"], "text/css; charset=utf-8");
  assert.equal(css.init.headers.Authorization, "Bearer t");
});

test("没设账号时用令牌唯一能看到的账号；没有令牌直接跳过", async () => {
  const dir = assetsDir(["root-a.css"]);
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.includes("/accounts?")) return Response.json({ result: [{ id: "only" }] });
    return new Response("{}", { status: 200 });
  };
  const result = await archiveSiteAssets({ dir, env: { CLOUDFLARE_API_TOKEN: "t" }, fetchImpl, log: quiet });
  assert.equal(result.uploaded, 1);
  assert.ok(urls[1].includes("/accounts/only/r2/"));
  const none = await archiveSiteAssets({ dir, env: {}, fetchImpl: () => assert.fail("不该请求"), log: quiet });
  assert.equal(none.skipped, "no-token");
});
