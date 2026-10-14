import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { parseAst, type Plugin } from "vite";

const VIRTUAL_ID = "virtual:model-icons";
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

export function lobehubIconsDir() {
  const require = createRequire(import.meta.url);
  return path.join(path.dirname(require.resolve("@lobehub/icons")), "..");
}

export type ModelIconMapping = { icon: string; keywords: string[] };

function modelMappingsNode(source: string) {
  const ast = parseAst(source);
  const imports = new Map<string, string>();
  for (const node of ast.body) {
    if (node.type === "ImportDeclaration") {
      const spec = node.specifiers.find((item) => item.type === "ImportDefaultSpecifier");
      const match = /^\.\.\/([A-Za-z0-9]+)$/.exec(node.source.value);
      if (spec && match) imports.set(spec.local.name, match[1]);
    }
  }
  for (const node of ast.body) {
    if (node.type === "ExportNamedDeclaration" && node.declaration?.type === "VariableDeclaration") {
      const decl = node.declaration.declarations.find((item) => item.id.type === "Identifier" && item.id.name === "modelMappings");
      if (decl?.init?.type === "ArrayExpression") return { imports, mappings: decl.init.elements };
    }
  }
  throw new Error("modelMappings not found in @lobehub/icons modelConfig");
}

// LobeHub 的 modelMappings 按顺序匹配、首个命中即止，顺序本身是数据（如 muse-spark 排在 spark 前）。
export function parseModelMappings(source: string): ModelIconMapping[] {
  const { imports, mappings } = modelMappingsNode(source);
  return mappings.flatMap((element) => {
    if (element?.type !== "ObjectExpression") return [];
    const prop = (name: string) => {
      for (const item of element.properties) {
        if (item.type === "Property" && item.key.type === "Identifier" && item.key.name === name) return item.value;
      }
      return undefined;
    };
    const iconNode = prop("Icon");
    const icon = iconNode?.type === "Identifier" ? imports.get(iconNode.name) : undefined;
    const keywordsNode = prop("keywords");
    const keywords =
      keywordsNode?.type === "ArrayExpression"
        ? keywordsNode.elements.flatMap((item) => (item?.type === "Literal" && typeof item.value === "string" ? [item.value] : []))
        : [];
    return icon && keywords.length > 0 ? [{ icon, keywords }] : [];
  });
}

export function modelIconMappings(iconsDir = lobehubIconsDir()): ModelIconMapping[] {
  const source = fs.readFileSync(path.join(iconsDir, "es/features/modelConfig.js"), "utf8");
  return parseModelMappings(source).filter(({ icon }) => fs.existsSync(path.join(iconsDir, "es", icon, "components/Mono.js")));
}

export function lobehubIconsVersion(iconsDir = lobehubIconsDir()): string {
  return JSON.parse(fs.readFileSync(path.join(iconsDir, "package.json"), "utf8")).version;
}

export function modelIcons(): Plugin {
  return {
    name: "model-icons",
    resolveId: (id: string) => (id === VIRTUAL_ID ? RESOLVED_ID : null),
    load: (id: string) =>
      id === RESOLVED_ID
        ? [
            `export const MODEL_ICON_MAPPINGS = ${JSON.stringify(modelIconMappings())};`,
            `export const MODEL_ICONS_VERSION = ${JSON.stringify(lobehubIconsVersion())};`,
          ].join("\n")
        : null,
  };
}
