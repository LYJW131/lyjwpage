import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

// Worker Loader 只在 workerd 里有：把 sandboxRunner 转成 JS 装进 Miniflare，真加载一次动态 Worker。
let worker: Miniflare;

before(async () => {
  const source = await readFile(fileURLToPath(new URL("./tools/code-sandbox.ts", import.meta.url).href), "utf8");
  worker = new Miniflare({
    workers: [{
      config: {
        name: "code-sandbox",
        compatibilityDate: "2026-10-09",
        env: { LOADER: { type: "worker-loader" } },
        manifest: {
          mainModule: "main.js",
          modules: {
            "main.js": {
              type: "esm",
              contents: 'import { sandboxRunner } from "./code-sandbox.js";\n' +
                "export default { async fetch(request, env) {\n" +
                "  const reads = [];\n" +
                "  const outcome = await sandboxRunner(env.LOADER)(await request.text(), async (view) => { reads.push(view); return { view }; });\n" +
                "  return Response.json({ outcome, reads });\n" +
                "} };",
            },
            "code-sandbox.js": {
              type: "esm",
              contents: stripTypeScriptTypes(source),
            },
          },
        },
      },
    }],
  });
});

after(() => worker.dispose());

async function run(code: string) {
  return (await worker.dispatchFetch("http://localhost/", { method: "POST", body: code })).json() as Promise<{ outcome: { ok: boolean; result?: unknown; error?: string }; reads: unknown[] }>;
}

test("沙箱里的代码经 status(view) 读回宿主给的数据并返回结果", async () => {
  const { outcome, reads } = await run('const a = await status("playing"); return [a.view, 1 + 1];');
  assert.deepEqual(outcome, { ok: true, result: ["playing", 2] });
  assert.deepEqual(reads, ["playing"]);
});

test("沙箱没有网络，抛错与不能 JSON 化的值都回成结果而不是宿主异常", async () => {
  const offline = await run('return await fetch("https://example.com").then((r) => r.status);');
  assert.equal(offline.outcome.ok, false);
  assert.deepEqual(await run('throw new Error("boom");'), { outcome: { ok: false, error: "boom" }, reads: [] });
  assert.deepEqual((await run("return { f() {}, n: 1 };")).outcome, { ok: true, result: { n: 1 } });
});
