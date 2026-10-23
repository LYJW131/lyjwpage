// 不用 shared/sha256.ts：访客设计流程能改 shared/，这里会进带写权限和密钥的 job
import { createHash } from "node:crypto";

export type ChecklistItem = { id: string; text: string };

// 契约：PR 描述里这两节的标题与条目格式，线程写 PR 时照 lyjwpage-verify「验证清单」写；改格式要同步那一节。
const CHECKLIST_HEADING = /^#{2,4}\s*验证清单\s*$/;
const WORDS_HEADING = /^#{2,4}\s*lyjw\s*原话\s*$/;
const ITEM = /^\s*[-*]\s*(V\d+)\s*[：:.、]\s*(.+?)\s*$/;

// Devin 会在描述末尾补徽章块，不算描述改动
const BADGE = /<!-- devin-review-badge-begin -->[\s\S]*?<!-- devin-review-badge-end -->/g;

// 分隔线可能是清单或原话内部的分组，只有其后再没有条目和引文时才当作描述的页脚截掉
function dropFooter(lines: string[]) {
  const rule = lines.findLastIndex((line) => /^-{3,}\s*$/.test(line));
  if (rule < 0 || lines.slice(rule + 1).some((line) => /^\s*(?:[-*+]\s|>)/.test(line))) return lines;
  return lines.slice(0, rule);
}

function section(lines: string[], heading: RegExp) {
  const start = lines.findIndex((line) => heading.test(line.trim()));
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,4}\s/.test(line));
  return dropFooter(end < 0 ? rest : rest.slice(0, end));
}

export function parseBody(body: string | null | undefined) {
  const lines = (body ?? "").replace(BADGE, "").replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/);
  const checklistLines = section(lines, CHECKLIST_HEADING);
  const checklist: ChecklistItem[] = [];
  for (const line of checklistLines ?? []) {
    const match = ITEM.exec(line);
    if (match && !checklist.some((item) => item.id === match[1])) checklist.push({ id: match[1], text: match[2] });
  }
  const words = section(lines, WORDS_HEADING)?.join("\n").trim() || null;
  return { checklist, words };
}

// 回执与判定只对签发时判定员和验证员读到的内容算数：有原话时是清单与原话，没原话时判定员读全文，就按全文。
// publish 把这个摘要写进评论，verify-receipt.ts 拿当前描述重算比对。
export function bodyDigest(body: string | null | undefined) {
  const { checklist, words } = parseBody(body);
  const text = words ?? (body ?? "").replace(BADGE, "").replace(/<!--[\s\S]*?-->/g, "").trim();
  return createHash("sha256").update(JSON.stringify({ checklist, words: text })).digest("hex");
}
