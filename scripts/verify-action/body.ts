// 不用 shared/sha256.ts：访客设计流程能改 shared/，这里会进带写权限和密钥的 job
import { createHash } from "node:crypto";

export type ChecklistItem = { id: string; text: string };

// 契约：PR 描述里这两节的标题与条目格式，线程写 PR 时照 lyjwpage-verify「验证清单」写；改格式要同步那一节。
const CHECKLIST_HEADING = /^#{2,4}\s*验证清单\s*$/;
const WORDS_HEADING = /^#{2,4}\s*lyjw\s*原话\s*$/;
const ITEM = /^\s*[-*]\s*(V\d+)\s*[：:.、]\s*(.+?)\s*$/;

// 两块机器写的注释不算描述改动：Devin 徽章，以及 verify-dispatch 用来触发 pull_request edited 的重跑标记。
// 别的 HTML 注释不删：正则认不全 Markdown 的代码与注释，删错会吞掉看得见的清单；不删只会让注释里的改动也作废回执、注释里的条目也照验，两头都偏保守
const BADGE = /<!-- devin-review-badge-begin -->[\s\S]*?<!-- devin-review-badge-end -->/g;
const RERUN = /<!-- verify-rerun-begin -->[\s\S]*?<!-- verify-rerun-end -->/g;
const RERUN_ID = /^\d+-\d+$/;

// 删到不再变，免得两块机器注释交错拼出一块新的
function dropMachineNotes(text: string) {
  for (let prev = ""; prev !== text; ) {
    prev = text;
    text = text.replace(BADGE, "").replace(RERUN, "");
  }
  return text;
}

export function visibleBody(body: string | null | undefined) {
  return dropMachineNotes(body ?? "");
}

export function stampRerun(body: string | null | undefined, id: string) {
  if (!RERUN_ID.test(id)) throw new Error("重跑标记要是 运行号-尝试号");
  const base = (body ?? "").replace(RERUN, "").trimEnd();
  const block = `<!-- verify-rerun-begin -->\n${id}\n<!-- verify-rerun-end -->`;
  return `${base}${base.length === 0 ? "" : "\n\n"}${block}\n`;
}

// 分隔线可能是清单或原话内部的分组，只有其后再没有条目和引文时才当作描述的页脚截掉
function dropFooter(lines: string[]) {
  const rule = lines.findLastIndex((line) => /^-{3,}\s*$/.test(line));
  if (rule < 0 || lines.slice(rule + 1).some((line) => /^\s*(?:[-*+]\s|>)/.test(line))) return lines;
  return lines.slice(0, rule);
}

// 同名标题可能不止一处（比如注释里留着旧清单），全部收进来，宁可多验不漏验
function section(lines: string[], heading: RegExp) {
  const starts = lines.flatMap((line, index) => (heading.test(line.trim()) ? [index] : []));
  if (starts.length === 0) return null;
  return starts.flatMap((start) => {
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => /^#{1,4}\s/.test(line));
    return dropFooter(end < 0 ? rest : rest.slice(0, end));
  });
}

export function parseBody(body: string | null | undefined) {
  const lines = visibleBody(body).split(/\r?\n/);
  const checklistLines = section(lines, CHECKLIST_HEADING);
  const texts = new Map<string, string[]>();
  for (const line of checklistLines ?? []) {
    const match = ITEM.exec(line);
    if (!match) continue;
    const seen = texts.get(match[1]) ?? [];
    if (!seen.includes(match[2])) texts.set(match[1], [...seen, match[2]]);
  }
  const checklist: ChecklistItem[] = [...texts].map(([id, parts]) => ({ id, text: parts.join("；") }));
  const words = section(lines, WORDS_HEADING)?.join("\n").trim() || null;
  return { checklist, words };
}

// 回执与判定只对签发时判定员和验证员读到的内容算数：有原话时是清单与原话，没原话时判定员读全文，就按全文。
// publish 把这个摘要写进评论，verify-receipt.ts 拿当前描述重算比对。
export function bodyDigest(body: string | null | undefined) {
  const { checklist, words } = parseBody(body);
  const text = words ?? visibleBody(body).trim();
  return createHash("sha256").update(JSON.stringify({ checklist, words: text })).digest("hex");
}
