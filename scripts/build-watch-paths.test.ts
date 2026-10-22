import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";
import { BUILD_WATCH_PATHS, PREVIEW_WATCH_PATHS, watches, workersFor } from "./build-watch-paths.ts";

test("目录末尾的 * 跨子目录匹配，根清单只认仓库根那一份", () => {
  assert.equal(watches(BUILD_WATCH_PATHS.core, "workers/core/src/state/deep/file.ts"), true);
  assert.equal(watches(BUILD_WATCH_PATHS.core, "package.json"), true);
  assert.deepEqual(workersFor(["apps/ios/package.json"], BUILD_WATCH_PATHS), []);
  assert.deepEqual(workersFor(["reporters/server-reporter/package.json"], BUILD_WATCH_PATHS), []);
});

test("排除先于包含：shared/ingest 不触发 core，AI 契约只触发 ai 与 site", () => {
  assert.deepEqual(workersFor(["shared/ingest/prepare.ts"], BUILD_WATCH_PATHS), ["site", "ingress", "collector"]);
  assert.deepEqual(workersFor(["shared/god-chat.ts"], BUILD_WATCH_PATHS), ["ai", "site"]);
  assert.deepEqual(workersFor(["shared/json.ts"], BUILD_WATCH_PATHS), ["core", "ai", "site", "ingress", "collector"]);
});

test("前缀通配：scripts/preview-* 触发 core 与 ai，其他脚本只触发 site", () => {
  assert.deepEqual(workersFor(["scripts/preview-worker-name.ts"], BUILD_WATCH_PATHS), ["core", "ai", "site"]);
  assert.deepEqual(workersFor(["scripts/pr-gate.ts"], BUILD_WATCH_PATHS), ["site"]);
});

test("只改文档、skill 与上报器不触发任何构建", () => {
  assert.deepEqual(workersFor(["README.md", "docs/workers-builds.md", ".claude/skills/x/SKILL.md", "reporters/a/b.ts"], BUILD_WATCH_PATHS), []);
  assert.deepEqual(workersFor(["docs/explainer/v2/index.html"], BUILD_WATCH_PATHS), ["site"]);
  assert.deepEqual(workersFor([".github/github-avatar.sha256"], BUILD_WATCH_PATHS), ["site"]);
});

test("分支上只有 core 与 site 构建，core 的 Preview 也盯 ai 与站点代码", () => {
  assert.deepEqual(workersFor(["workers/ai/src/chat/egress.ts"], PREVIEW_WATCH_PATHS), ["core"]);
  assert.deepEqual(workersFor(["src/components/card.tsx"], PREVIEW_WATCH_PATHS), ["core", "site"]);
  assert.deepEqual(workersFor(["workers/collector/src/index.ts", "workers/ingress/src/index.ts"], PREVIEW_WATCH_PATHS), []);
  assert.deepEqual(workersFor(["shared/ingest/prepare.ts"], PREVIEW_WATCH_PATHS), ["site"]);
  assert.deepEqual(workersFor([".github/github-avatar.sha256"], PREVIEW_WATCH_PATHS), []);
});

function runtimeImports(file: string) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest);
  const specifiers: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const typeOnly = ts.isImportDeclaration(node)
        ? node.importClause?.isTypeOnly ||
          (node.importClause && !node.importClause.name && node.importClause.namedBindings && ts.isNamedImports(node.importClause.namedBindings) &&
            node.importClause.namedBindings.elements.length > 0 && node.importClause.namedBindings.elements.every((element) => element.isTypeOnly))
        : node.isTypeOnly;
      if (!typeOnly) specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
}

function resolveLocal(from: string, specifier: string) {
  const base = specifier.startsWith("@shared/") ? path.join("shared", specifier.slice("@shared/".length)) : specifier.startsWith(".") ? path.join(path.dirname(from), specifier) : null;
  if (base === null) return null;
  const found = [base, `${base}.ts`, path.join(base, "index.ts")].find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
  assert.ok(found, `${from} 导入的 ${specifier} 找不到文件`);
  return found;
}

test("ai Worker 从入口出发的运行时导入都在 ai 的生产监视路径里", () => {
  const entry = /^main\s*=\s*"([^"]+)"/m.exec(readFileSync("workers/ai/wrangler.toml", "utf8"))?.[1];
  assert.ok(entry, "workers/ai/wrangler.toml 没写 main");
  const seen = new Set<string>();
  const queue = [path.join("workers/ai", entry)];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of runtimeImports(file)) {
      const resolved = resolveLocal(file, specifier);
      if (resolved !== null) queue.push(resolved);
    }
  }
  assert.ok([...seen].some((file) => file.startsWith("shared/")), "导入图里没走到 shared/，解析可能坏了");
  const unwatched = [...seen].filter((file) => !watches(BUILD_WATCH_PATHS.ai, file)).sort();
  assert.deepEqual(unwatched, [], "这些文件进了 ai 的产物却不触发 ai 构建：加进 BUILD_WATCH_PATHS.ai，并同步 Cloudflare 控制台");
});
