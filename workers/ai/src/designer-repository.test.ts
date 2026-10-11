import assert from "node:assert/strict";
import test from "node:test";

import { BUILD_REPO } from "@shared/build-routine";

import type { Env } from "./runtime.ts";
import { cleanPath, globMatcher, openRepository, type RepoStore } from "./chat/designer-repository.ts";

const SHA = "a".repeat(40);

test("glob 通配符按段匹配：**/ 匹配零或多层目录，* 与 ? 不跨目录", () => {
  const match = globMatcher("src/**/x.ts")!;
  assert.ok(match("src/x.ts"));
  assert.ok(match("src/a/x.ts"));
  assert.ok(match("src/a/b/x.ts"));
  assert.ok(!match("src/ax.ts"));
  assert.ok(!match("other/x.ts"));
  const single = globMatcher("src/*.ts")!;
  assert.ok(single("src/a.ts"));
  assert.ok(!single("src/a/b.ts"));
  const quest = globMatcher("src/a?.ts")!;
  assert.ok(quest("src/ab.ts"));
  assert.ok(!quest("src/a/b.ts"));
  const cross = globMatcher("src/**.ts")!;
  assert.ok(cross("src/a/b/c.ts"));
  assert.ok(cross("src/x.ts"));
});

test("glob 对抗性模式不炸：通配符超限直接判无效，有界模式正常匹配", () => {
  assert.equal(globMatcher(`${"*a".repeat(13)}b`), null);
  const bounded = globMatcher(`${"*a".repeat(6)}b`)!;
  assert.ok(bounded("aaaaaaaaaab"));
  assert.ok(!bounded("aaaaaaaaaac"));
  assert.equal(globMatcher(`${"*a".repeat(40)}b`), null);
  assert.equal(globMatcher(""), null);
  assert.equal(globMatcher(42), null);
});

const tree = (paths: string[]) => ({
  truncated: false,
  tree: paths.map((path, index) => ({ path, type: "blob", mode: "100644", sha: `${index.toString(16).padStart(4, "0")}${"b".repeat(36)}` })),
});

function repo(files: Record<string, string | null>) {
  const paths = Object.keys(files);
  const store = new Map<string, string>();
  const fetched: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    fetched.push(url);
    if (url.endsWith(`/repos/${BUILD_REPO}/git/ref/heads/main`)) return Response.json({ object: { sha: SHA } });
    if (url.endsWith(`/repos/${BUILD_REPO}/git/trees/${SHA}?recursive=1`)) return Response.json(tree(paths));
    if (url.startsWith(`https://raw.githubusercontent.com/${BUILD_REPO}/${SHA}/`)) {
      const path = decodeURIComponent(url.slice(`https://raw.githubusercontent.com/${BUILD_REPO}/${SHA}/`.length));
      const text = files[path];
      return text === null || text === undefined ? new Response("nope", { status: 404 }) : new Response(text);
    }
    return new Response("unexpected", { status: 400 });
  }) as typeof fetch;
  const records: RepoStore = { get: (key) => store.get(key), put: (key, value) => void store.set(key, value) };
  return { open: () => openRepository({ env: {} as Env, fetcher, store: records }), fetched, store };
}

test("read 按行号分页；行超长标出裁剪，输出到界时继续点落在最后一条完整行之后", async () => {
  const long = "x".repeat(5000);
  const file = ["first", long, ...Array.from({ length: 300 }, (_, index) => `line-${index}-` + "y".repeat(60))].join("\n");
  const { open } = repo({ "a.txt": file });
  const repo1 = await open();
  const page = await repo1.read("a.txt", 1, 3);
  assert.ok(!("error" in page));
  assert.match(page.text, /1\tfirst\n2\tx{2000}… \[line clipped\]\n3\tline-0-y+/);
  assert.match(page.text, /continue with offset 4/);
  // 行长 ~70、行号前缀 ~6：16 KiB 输出装不满 300 行，继续点必须指向最后一条已发出的完整行 + 1。
  const wide = await repo1.read("a.txt");
  assert.ok(!("error" in wide));
  const offset = /continue with offset (\d+)/.exec(wide.text)?.[1];
  const emitted = Number(offset) - 1;
  assert.ok(emitted < 302 && emitted > 100, `emitted ${emitted}`);
  assert.ok(!wide.text.includes(`\n${emitted + 1}\t`));
  const next = await repo1.read("a.txt", Number(offset), 2);
  assert.ok(!("error" in next));
  assert.match(next.text, new RegExp(`${offset}\\t`));
});

test("grep 报告跳过的不可读文件、输出行有界、文件数超限报错", async () => {
  const { open } = repo({ "a.ts": "alpha\nbeta needle\ngamma", "b.ts": "needle again", "bin.dat": null });
  const repo1 = await open();
  const hit = await repo1.grep("needle", "*.ts", true);
  assert.ok(!("error" in hit));
  assert.match(hit.text, /2 matches in 2 files/);
  assert.match(hit.text, /a\.ts:2: beta needle/);
  const skip = await repo1.grep("needle", "*", true);
  assert.ok(!("error" in skip));
  assert.match(skip.text, /skipped 1 unreadable file: bin\.dat/);
  const none = await repo1.grep("needle", "*.dat", true);
  assert.ok(!("error" in none));
  assert.match(none.text, /0 matches in 0 files; skipped 1 unreadable file: bin\.dat/);
  const tooWide = await repo1.grep("needle", "**/*.ts", true);
  assert.ok(!("error" in tooWide));
});

test("grep 选中文件超过上限时报错而不是假装搜过全仓库", async () => {
  const files: Record<string, string> = {};
  for (let index = 0; index < 70; index++) files[`f${index}.ts`] = "needle";
  const { open } = repo(files);
  const repo1 = await open();
  const out = await repo1.grep("needle", "*.ts", true);
  assert.ok("error" in out);
  assert.match(out.error, /70 files/);
});

test("快照按固定 SHA 取文件：大小写不敏感搜索、清单外路径与脏路径拒绝、目录通配结果有界", async () => {
  const files: Record<string, string> = {};
  for (let index = 0; index < 210; index++) files[`dir/f${index}.ts`] = "x";
  files["keep.ts"] = "NeEdLe";
  const { open, fetched } = repo(files);
  const repo1 = await open();
  assert.equal(repo1.sha, SHA);
  const listed = repo1.list("dir/*.ts");
  assert.equal(listed.paths.length, 200);
  assert.equal(listed.truncated, true);
  const hit = await repo1.grep("needle", "keep.ts", false);
  assert.ok(!("error" in hit));
  assert.match(hit.text, /keep\.ts:1: NeEdLe/);
  assert.deepEqual(await repo1.read("../secret.txt"), { error: "No such file in the repository snapshot: ../secret.txt" });
  assert.equal(cleanPath("a//b"), null);
  assert.equal(cleanPath("a%20b"), null);
  assert.equal(cleanPath("/abs"), null);
  assert.ok(fetched.every((url) => url.includes(SHA) || url.includes("/repos/")));
});

test("清单持久化后不再请求 GitHub：同一 store 直接复用记录", async () => {
  const { open, fetched, store } = repo({ "a.ts": "needle" });
  await open();
  assert.equal(fetched.filter((url) => url.includes("api.github.com")).length, 2);
  fetched.length = 0;
  await open();
  assert.equal(fetched.length, 0);
  assert.ok(store.get("repo")?.includes(SHA));
});
