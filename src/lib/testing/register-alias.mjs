import fs from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const EXTENSIONS = ["", ".ts", ".tsx", ".mts", ".mjs", ".js", ".json"];

// Node ESM 不会补全打包器可解析的相对路径后缀，跨 Worker 导入时需显式补齐。
function relativeBase(specifier, context) {
  if (!specifier.startsWith(".") || !context.parentURL?.startsWith("file:")) return null;
  const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
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
