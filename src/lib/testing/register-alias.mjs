import fs from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * 把 `@/` 映射到 `<repo>/src/`，给 `node --test` 用（package.json 的 test 脚本
 * 用 --import 挂上）。tsconfig 的 paths 只有 tsc / Next 认，Node 自己不认。
 *
 * 用同步的 registerHooks，不走 `module.register()` 那套单独 loader 线程：
 * 测试进程一个 hook 就够，不用为它多起一条线程。CI 的 Node 24 已经有它。
 */
const SRC_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const EXTENSIONS = ["", ".ts", ".tsx", ".mts", ".mjs", ".js", ".json"];

/**
 * 相对路径也要补后缀。
 *
 * Worker 那边靠打包器解析 `./live-platform` 这种不带后缀的相对路径，Node 的 ESM
 * 不会自己补 —— 一个别名 import 只要落在 workers/api 里，顺着它的相对 import 就会
 * ERR_MODULE_NOT_FOUND。补后缀和别名走同一套候选表，已经带后缀的原样通过。
 */
function relativeBase(specifier, context) {
  if (!specifier.startsWith(".") || !context.parentURL?.startsWith("file:")) return null;
  const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
  // 本来就能解析的原样交回默认解析器，这里只管补后缀那一种
  return fs.existsSync(base) ? null : base;
}

function resolveAlias(specifier, context, nextResolve) {
  const aliased = ["@/", "@shared/", "@api/"].some((prefix) => specifier.startsWith(prefix));
  const relative = aliased ? null : relativeBase(specifier, context);
  if (!aliased && relative == null) {
    return nextResolve(specifier, context);
  }

  const base = relative
    ?? (specifier.startsWith("@shared/")
      ? path.join(SRC_ROOT, "../shared", specifier.slice(8))
      : specifier.startsWith("@api/")
        ? path.join(SRC_ROOT, "../workers/api/src", specifier.slice(5))
        : path.join(SRC_ROOT, specifier.slice(2)));
  for (const extension of EXTENSIONS) {
    const candidate = base + extension;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return nextResolve(pathToFileURL(candidate).href, context);
    }
  }

  const index = path.join(base, "index.ts");
  if (fs.existsSync(index) && fs.statSync(index).isFile()) {
    return nextResolve(pathToFileURL(index).href, context);
  }

  return nextResolve(specifier, context);
}

registerHooks({ resolve: resolveAlias });
