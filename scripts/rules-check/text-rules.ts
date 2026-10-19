import { commentTexts, HELPER_SCOPE, type Issue } from "./source.ts";

const TICKET_RE = /#\d+|https?:\/\/\S+/;
const TODO_RE = /\b(?:TODO|FIXME)\b/;
const BAKED_IMG_RE = /https?:\/\/[^\s"')`]+\/img\//;

export function checkTodo(file: string, text: string) {
  const issues: Issue[] = [];
  for (const comment of commentTexts(file, text)) {
    const match = TODO_RE.exec(comment.text);
    if (!match || TICKET_RE.test(comment.text)) continue;
    const line = comment.line + (comment.text.slice(0, match.index).match(/\n/g) ?? []).length;
    issues.push({ file, line, rule: "todo-ticket", message: `待办标记要挂跟踪单号：写成 TODO(#123) 或带上链接；现在就去做的就别留标记（AGENTS.md「文档与注释」）。` });
  }
  return issues;
}

export function checkBakedImgUrl(file: string, text: string) {
  const issues: Issue[] = [];
  text.split("\n").forEach((line, index) => {
    if (BAKED_IMG_RE.test(line)) {
      issues.push({ file, line: index + 1, rule: "img-baked-url", message: "R2 图片一律同源 /img/<objectKey>（shared/asset-url.ts#publicAssetPath），不烧交付域；要绝对地址的场合读环境变量。" });
    }
  });
  return issues;
}

const SHA256_HEX_IMPL = "shared/sha256.ts";
const INLINE_SCRIPT_JSON_IMPL = "src/lib/inline-script.ts";
const LT_ESCAPE_RE = /\.replace\(\/<\/g,\s*["'`]\\\\u003c/;
const HEX_BYTE_RE = /toString\(16\)\.padStart\(2,\s*["'`]0["'`]\)/;

export function checkSha256Hex(file: string, text: string) {
  if (!HELPER_SCOPE.test(file) || file === SHA256_HEX_IMPL) return [];
  return text.split("\n").flatMap((line, index) => HEX_BYTE_RE.test(line)
    ? [{ file, line: index + 1, rule: "sha256-hex", message: "SHA-256 转十六进制用 @shared/sha256#sha256Hex，不再复制一份 toString(16).padStart(2, \"0\")。" }]
    : []);
}

export function checkInlineScriptJson(file: string, text: string) {
  if (!HELPER_SCOPE.test(file) || file === INLINE_SCRIPT_JSON_IMPL) return [];
  return text.split("\n").flatMap((line, index) => LT_ESCAPE_RE.test(line)
    ? [{ file, line: index + 1, rule: "inline-script-json", message: "内联脚本里的 JSON 用 @/lib/inline-script#scriptJson 转义，不再各写一份 replace(/</g, \"\\\\u003c\")。" }]
    : []);
}
