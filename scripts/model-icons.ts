import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { parseAst } from "vite";

const VIRTUAL_ID = "virtual:model-icons";
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

export function lobehubIconsDir() {
  const require = createRequire(import.meta.url);
  return path.join(path.dirname(require.resolve("@lobehub/icons")), "..");
}

// LobeHub 的 modelMappings 按顺序匹配、首个命中即止，顺序本身是数据（如 muse-spark 排在 spark 前）。
export function parseModelMappings(source) {
  const ast = parseAst(source);
  const imports = new Map();
  let mappings = null;
  for (const node of ast.body) {
    if (node.type === "ImportDeclaration") {
      const spec = node.specifiers.find((item) => item.type === "ImportDefaultSpecifier");
      const match = /^\.\.\/([A-Za-z0-9]+)$/.exec(node.source.value);
      if (spec && match) imports.set(spec.local.name, match[1]);
    }
    if (node.type === "ExportNamedDeclaration" && node.declaration?.type === "VariableDeclaration") {
      const decl = node.declaration.declarations.find((item) => item.id.name === "modelMappings");
      if (decl?.init?.type === "ArrayExpression") mappings = decl.init.elements;
    }
  }
  if (!mappings) throw new Error("modelMappings not found in @lobehub/icons modelConfig");
  return mappings.flatMap((element) => {
    const prop = (name) => element.properties.find((item) => item.key?.name === name)?.value;
    const icon = imports.get(prop("Icon")?.name);
    const keywords = prop("keywords")?.elements?.map((item) => item.value).filter((value) => typeof value === "string") ?? [];
    return icon && keywords.length > 0 ? [{ icon, keywords }] : [];
  });
}

export function modelIconMappings(iconsDir = lobehubIconsDir()) {
  const source = fs.readFileSync(path.join(iconsDir, "es/features/modelConfig.js"), "utf8");
  return parseModelMappings(source).filter(({ icon }) => fs.existsSync(path.join(iconsDir, "es", icon, "components/Mono.js")));
}

export function lobehubIconsVersion(iconsDir = lobehubIconsDir()) {
  return JSON.parse(fs.readFileSync(path.join(iconsDir, "package.json"), "utf8")).version;
}

export function modelIcons() {
  return {
    name: "model-icons",
    resolveId: (id) => (id === VIRTUAL_ID ? RESOLVED_ID : null),
    load: (id) =>
      id === RESOLVED_ID
        ? [
            `export const MODEL_ICON_MAPPINGS = ${JSON.stringify(modelIconMappings())};`,
            `export const MODEL_ICONS_VERSION = ${JSON.stringify(lobehubIconsVersion())};`,
          ].join("\n")
        : null,
  };
}
