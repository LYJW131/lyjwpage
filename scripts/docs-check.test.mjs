import assert from "node:assert/strict";
import test from "node:test";

import {
  NESTED_AGENTS_MAX_LINES,
  ROOT_AGENTS_MAX_LINES,
  checkMarkdown,
  checkStructure,
  collectAnchors,
  countAgentsLines,
  findTimeline,
  formatIssues,
  githubSlug,
  makeContext,
  parseDocType,
  parsePathToken,
  resolveRef,
  runChecks,
  scanLines,
  splitInlineCode,
} from "./docs-check.mjs";

function ctxOf(files, { submodules = [], ignored = [], shallow = false, commits = null } = {}) {
  const texts = new Map(Object.entries(files));
  const ignoredSet = new Set(ignored);
  return makeContext({
    tracked: [...texts.keys()],
    submodules,
    ignored: (paths) => new Set(paths.filter((p) => ignoredSet.has(p))),
    readText: (rel) => texts.get(rel) ?? null,
    shallow,
    commitExists: (sha) => (commits ? commits.includes(sha) : true),
  });
}

const tags = (issues) => issues.map((issue) => `${issue.rule}@${issue.line}`);
const typeLine = (type) => `# 标题\n\n> 类型：${type}\n\n正文\n`;

test("标题锚点按 GitHub 规则：中文保留、全角标点去掉、空格变连字符", () => {
  assert.equal(githubSlug("跨域活动脉搏（Pulse）"), "跨域活动脉搏pulse");
  assert.equal(githubSlug("长期归档（D1）"), "长期归档d1");
  assert.equal(githubSlug("Claude Code 云端线程用量"), "claude-code-云端线程用量");
  assert.equal(githubSlug("`ACCESS_CLIENTS` 与 [链接](./x.md)"), "access_clients-与-链接");
});

test("标题锚点移除嵌套标签，不把拼接后形成的标签名留在锚点里", () => {
  assert.equal(githubSlug("<b>Visible</b> heading"), "visible-heading");
  assert.equal(githubSlug("<scrip<script>t>Visible</script> heading"), "visible-heading");
});

test("锚点集合：重名标题加序号，围栏里的标题不算，id 属性算", () => {
  const anchors = collectAnchors(["## 本地开发", "", "```sh", "# 不是标题", "```", "", "## 本地开发", "", '<a id="Custom-Anchor"></a>'].join("\n"));
  assert.deepEqual([...anchors].sort(), ["custom-anchor", "本地开发", "本地开发-1"]);
});

test("逐行扫描围栏：``` 与 ~~~ 各自配对，长围栏里的短围栏不收尾", () => {
  const lines = scanLines(["外", "```sh", "内", "````", "```", "还在里面", "````", "~~~", "波浪", "~~~", "外2"].join("\n"));
  assert.deepEqual(lines.map((line) => line.inFence), [false, true, true, true, true, true, true, true, true, true, false]);
});

test("行内代码：抽出内容、原位换成空格，双反引号与没闭合的反引号都能处理", () => {
  const { spans, rest } = splitInlineCode("看 `a/b.ts` 和 ``x ` y`` 还有 ` 没闭合");
  assert.deepEqual(spans, ["a/b.ts", "x ` y"]);
  assert.equal(rest.includes("a/b.ts"), false);
  assert.equal(rest.length, "看 `a/b.ts` 和 ``x ` y`` 还有 ` 没闭合".length);
  assert.ok(rest.endsWith("` 没闭合"));
});

test("时间线：日期与「MM-DD 起」「N 月 N 日」报出，核对戳、区间和 cron 表达式不报", () => {
  assert.deepEqual(findTimeline("2026-09-29 部署"), ["2026-09-29"]);
  assert.deepEqual(findTimeline("09-25 起固定每分钟"), ["09-25 起"]);
  assert.deepEqual(findTimeline("2026-09 起改成"), ["2026-09 起"]);
  assert.deepEqual(findTimeline("9 月 17 日之前的旧数据"), ["9 月 17 日"]);
  assert.deepEqual(findTimeline("2026 年 9 月改的"), ["2026 年 9 月"]);
  assert.deepEqual(findTimeline("核对于 2026-09-29，方式：读代码"), []);
  assert.deepEqual(findTimeline("按 04edf60 2026-09-22 核对，快照不维护"), []);
  assert.deepEqual(findTimeline("间隔 10-15 分钟，cron 1-59/10，端口 8788，版本 0.35.3"), []);
});

test("文首类型：只认前 6 行的 `> 类型：`，record 的核对句要在同一段引用里", () => {
  assert.deepEqual(parseDocType("# T\n\n> 类型：reference\n"), { type: "reference", stamp: null });
  const record = parseDocType("# T\n\n> 类型：record。按 04edf60 2026-09-22 核对，快照不维护，不当现状引用。\n");
  assert.deepEqual(record, { type: "record", stamp: { sha: "04edf60", date: "2026-09-22" } });
  const split = parseDocType("# T\n\n> 类型：record\n> 按 04edf60 2026-09-22 核对，快照不维护，不当现状引用\n");
  assert.deepEqual(split?.stamp, { sha: "04edf60", date: "2026-09-22" });
  assert.equal(parseDocType("# T\n\n\n\n\n\n> 类型：reference\n"), null);
  assert.equal(parseDocType("# T\n\n没有标注\n"), null);
});

test("哪些反引号内容算仓库路径：宁可漏查也不误报", () => {
  const ctx = ctxOf({ "src/lib/a.ts": "", "workers/api/src/stores/x.ts": "", "package.json": "" });
  const ref = (token) => parsePathToken(token, ctx)?.ref ?? null;
  assert.equal(ref("src/lib/a.ts"), "src/lib/a.ts");
  assert.equal(ref("./src/lib/a.ts"), "src/lib/a.ts");
  assert.equal(ref("package.json"), "package.json");
  assert.equal(ref("workers/api/src/stores"), "workers/api/src/stores");
  assert.equal(ref("src/lib/a.ts:12-30"), "src/lib/a.ts");
  assert.equal(ref("src/lib/a.ts#Sym"), "src/lib/a.ts");
  for (const skipped of [
    "https://lyjw.me/a.ts", "dsm:/volume3/docker/x.yml", "file://x.md", "/data/traffic.json", "/api/status/x", "~/.claude/skills",
    "src/lib/<名称>.ts", "docs/*.md", "sha256….png", "pnpm dev", "pnpm --dir workers/api test", "Next.js", ".env", ".mts",
    "lyjw.me", "api2.cursor.sh", "X/now", "positionMs", "@lobehub/icons/es/x", "node_modules/next/dist/docs/",
  ]) {
    assert.equal(parsePathToken(skipped, ctx), null, skipped);
  }
});

test("解析路径：先按 md 所在目录，再按仓库根；裸文件名只要仓库里有同名文件", () => {
  const ctx = ctxOf(
    { "workers/api/README.md": "", "workers/api/src/index.ts": "", "src/lib/status-views.ts": "", "shared/lag.ts": "" },
    { submodules: ["reporters/hub"], ignored: ["public/explainer/", "workers/api/.dev.vars"] },
  );
  assert.equal(resolveRef(ctx, "workers/api/README.md", "src/index.ts"), "workers/api/src/index.ts");
  assert.equal(resolveRef(ctx, "workers/api/README.md", "src/lib/status-views.ts"), "src/lib/status-views.ts");
  assert.equal(resolveRef(ctx, "workers/api/README.md", "../../shared/lag.ts"), "shared/lag.ts");
  assert.equal(resolveRef(ctx, "workers/api/README.md", "shared"), "shared");
  assert.equal(resolveRef(ctx, "docs/x.md", "status-views.ts", { bare: true }), "status-views.ts");
  assert.equal(resolveRef(ctx, "docs/x.md", "src/lib/status-views", {}), "src/lib/status-views.ts");
  assert.equal(resolveRef(ctx, "docs/x.md", "reporters/hub/build.sh"), "reporters/hub/build.sh");
  assert.equal(resolveRef(ctx, "docs/x.md", "public/explainer/", { dirRef: true }), "public/explainer");
  assert.equal(resolveRef(ctx, "workers/api/README.md", ".dev.vars"), "workers/api/.dev.vars");
  assert.equal(resolveRef(ctx, "docs/x.md", "src/gone.ts"), null);
  assert.equal(resolveRef(ctx, "docs/x.md", "../../outside.ts"), null);
});

test("链接：文件、锚点、HTML 资源、外链与围栏各按规矩查", () => {
  const ctx = ctxOf({
    "docs/a.md": "## 存在的标题\n",
    "docs/img/x.webp": "",
    "docs/b.md": "",
  });
  const text = [
    "[好](./a.md#存在的标题) [坏文件](./missing.md) [坏锚点](./a.md#不存在) [外链](https://x.dev/y.md) [邮件](mailto:a@b.c)",
    "[同文锚点](#本篇标题) [同文坏锚点](#没有)",
    '<img src="img/x.webp"> <img src="img/y.webp">',
    "[定义]: ./b.md",
    "```md",
    "[围栏里的坏链接](./nope.md)",
    "```",
    "## 本篇标题",
  ].join("\n");
  const issues = checkMarkdown(ctx, "docs/b.md", text);
  assert.deepEqual(tags(issues), ["link@1", "link@1", "link@2", "link@3"]);
  assert.match(issues[0].message, /missing\.md/);
  assert.match(issues[1].message, /不存在/);
});

test("反引号路径与出处戳记：路径、符号、行号写法", () => {
  const ctx = ctxOf({
    "src/a.ts": "export const REAL_SYMBOL = 1;\nexport class Box { open() {} }\n",
    "wrangler.toml": '[vars.ACCESS_CLIENTS]\n',
    "docs/x.md": "",
    "docs/y.md": "## 有的标题\n",
  });
  const text = [
    "`src/a.ts#REAL_SYMBOL` `src/a.ts#GONE_SYMBOL` `src/a.ts#Box.open` `src/a.ts#Box.close()`",
    "`wrangler.toml#ACCESS_CLIENTS` `src/a.ts#12` `src/missing.ts` `src/a.ts:12`",
    "`y.md#有的标题` `y.md#没有的标题`",
  ].join("\n");
  const issues = checkMarkdown(ctx, "docs/x.md", text);
  assert.deepEqual(tags(issues), ["symbol@1", "symbol@1", "symbol@2", "path@2", "symbol@3"]);
  assert.match(issues[0].message, /GONE_SYMBOL/);
  assert.match(issues[1].message, /close/);
  assert.match(issues[2].message, /不是标识符/);
});

test("符号匹配把美元符号按字面量处理，并保持完整标识符边界", () => {
  const ctx = ctxOf({ "src/a.ts": "const $value = 1; const suffix$ = 2; const longer$value = 3;", "docs/x.md": "" });
  const issues = checkMarkdown(ctx, "docs/x.md", "`src/a.ts#$value` `src/a.ts#suffix$` `src/a.ts#value` `src/a.ts#suffix`");
  assert.deepEqual(issues.map((issue) => issue.rule), ["symbol", "symbol"]);
  assert.match(issues[0].message, /value/);
  assert.match(issues[1].message, /suffix/);
});

test("allow 注释放行同一行，但必须写理由；next 自动块不查", () => {
  const ctx = ctxOf({ "docs/x.md": "" });
  const text = [
    "`src/gone.ts` 2026-09-29 <!-- allow: 快照里的旧路径 -->",
    "`src/gone.ts` <!-- allow: -->",
    "`src/gone.ts`",
    "<!-- BEGIN:nextjs-agent-rules -->",
    "`node_modules/next/dist/x.ts` `src/托管块里的坏路径.ts` 2026-09-29",
    "<!-- END:nextjs-agent-rules -->",
    "`src/gone2.ts`",
  ].join("\n");
  assert.deepEqual(tags(checkMarkdown(ctx, "docs/x.md", text)), ["allow@2", "path@3", "path@7"]);
});

test("record 不查时间线，但引用照查；围栏与行内代码里的日期不算", () => {
  const ctx = ctxOf({ "docs/x.md": "" });
  const text = ["2026-09-29 之后改了 `src/gone.ts`", "`2025-02-14` 是字面值", "```", "2026-09-29", "```"].join("\n");
  assert.deepEqual(tags(checkMarkdown(ctx, "docs/x.md", text, { docType: "record" })), ["path@1"]);
  assert.deepEqual(tags(checkMarkdown(ctx, "docs/x.md", text, { docType: "reference" })), ["path@1", "timeline@1"]);
});

test("AGENTS.md 行数：根文件不计 next 自动块，其余全算", () => {
  const block = "<!-- BEGIN:nextjs-agent-rules -->\n\n# 托管\n\n<!-- END:nextjs-agent-rules -->\n";
  const body = (n) => Array.from({ length: n }, (_, i) => `行 ${i}`).join("\n");
  assert.equal(countAgentsLines(`${block}${body(10)}\n`, { root: true }), 10);
  assert.equal(countAgentsLines(`${block}${body(10)}\n`, { root: false }), 15);
  assert.equal(countAgentsLines("<!-- BEGIN:nextjs-agent-rules -->\n乱\n", { root: true }), 2);
  assert.equal(countAgentsLines(body(3), { root: true }), 3);
});

test("结构：体积上限与 CLAUDE.md 配对", () => {
  const lines = (n) => `${Array.from({ length: n }, (_, i) => `行 ${i}`).join("\n")}\n`;
  const ctx = ctxOf({
    "AGENTS.md": lines(ROOT_AGENTS_MAX_LINES + 1),
    "CLAUDE.md": "@AGENTS.md\n",
    "workers/a/AGENTS.md": lines(NESTED_AGENTS_MAX_LINES),
    "workers/a/CLAUDE.md": "@AGENTS.md",
    "workers/b/AGENTS.md": lines(NESTED_AGENTS_MAX_LINES + 1),
    "workers/b/CLAUDE.md": "别的内容\n",
    "workers/c/AGENTS.md": lines(3),
  });
  const issues = checkStructure(ctx, [...ctx.files].filter((file) => file.endsWith(".md")).sort());
  assert.deepEqual(issues.map((issue) => `${issue.file}:${issue.rule}`), [
    "AGENTS.md:size", "workers/b/AGENTS.md:size", "workers/b/CLAUDE.md:pair", "workers/c/AGENTS.md:pair",
  ]);
});

test("结构：docs 每篇要有类型，record 要有核对句，索引要登记且类型一致", () => {
  const index = [
    "# 索引", "", "> 类型：reference", "",
    "| [参考](./ref.md) | reference | x |",
    "| [记录](./rec.md) | reference | x |",
    "| [手册](./sub/run.md) | runbook | x |",
  ].join("\n");
  const ctx = ctxOf({
    "docs/README.md": index,
    "docs/ref.md": typeLine("reference"),
    "docs/rec.md": "# 记录\n\n> 类型：record。按 abc1234 2026-09-22 核对，快照不维护，不当现状引用。\n",
    "docs/sub/run.md": typeLine("runbook"),
    "docs/none.md": "# 没标注\n",
    "docs/bad.md": typeLine("guide"),
    "docs/norecord.md": "# 缺核对句\n\n> 类型：record\n",
    "docs/AGENTS.md": "# 不用标类型\n",
    "docs/CLAUDE.md": "@AGENTS.md\n",
  }, { commits: ["abc1234"] });
  const issues = checkStructure(ctx, [...ctx.files].filter((file) => file.endsWith(".md")).sort());
  assert.deepEqual(issues.map((issue) => `${issue.file}:${issue.rule}`).sort(), [
    "docs/README.md:index",
    "docs/bad.md:index",
    "docs/bad.md:type",
    "docs/none.md:index",
    "docs/none.md:type",
    "docs/norecord.md:index",
    "docs/norecord.md:type",
  ]);
});

test("record 的 sha：非浅克隆时核实存在，浅克隆里跳过", () => {
  const files = {
    "docs/README.md": "# 索引\n\n> 类型：reference\n\n| [记录](./rec.md) | record | x |\n",
    "docs/rec.md": "# 记录\n\n> 类型：record。按 deadbee 2026-09-22 核对，快照不维护，不当现状引用。\n",
  };
  const list = (ctx) => checkStructure(ctx, [...ctx.files].sort()).map((issue) => issue.rule);
  assert.deepEqual(list(ctxOf(files, { commits: ["abc1234"] })), ["type"]);
  assert.deepEqual(list(ctxOf(files, { commits: ["abc1234"], shallow: true })), []);
});

test("整体：跳过子模块与 node_modules 里的 md，结果按文件与行号排序，输出可读", () => {
  const ctx = ctxOf(
    {
      "README.md": "`src/gone.ts`\n[断](./none.md)\n",
      "node_modules/pkg/README.md": "`src/gone.ts`\n",
      "reporters/hub/README.md": "`src/gone.ts`\n",
      "src/a.ts": "",
    },
    { submodules: ["reporters/hub"] },
  );
  const { issues, checked } = runChecks(ctx);
  assert.equal(checked, 1);
  assert.deepEqual(tags(issues), ["path@1", "link@2"]);
  assert.match(formatIssues(issues), /^README\.md:1 {2}\[path\] /);
});
