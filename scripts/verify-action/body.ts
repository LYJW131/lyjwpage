export type ChecklistItem = { id: string; text: string };

// 契约：PR 描述里这两节的标题与条目格式，线程写 PR 时照 lyjwpage-verify「验证清单」写；改格式要同步那一节。
const CHECKLIST_HEADING = /^#{2,4}\s*验证清单\s*$/;
const WORDS_HEADING = /^#{2,4}\s*lyjw\s*原话\s*$/;
const ITEM = /^\s*[-*]\s*(V\d+)\s*[：:.、]\s*(.+?)\s*$/;

function section(lines: string[], heading: RegExp) {
  const start = lines.findIndex((line) => heading.test(line.trim()));
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,4}\s/.test(line));
  return end < 0 ? rest : rest.slice(0, end);
}

export function parseBody(body: string | null | undefined) {
  const lines = (body ?? "").replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/);
  const checklistLines = section(lines, CHECKLIST_HEADING);
  const checklist: ChecklistItem[] = [];
  for (const line of checklistLines ?? []) {
    const match = ITEM.exec(line);
    if (match && !checklist.some((item) => item.id === match[1])) checklist.push({ id: match[1], text: match[2] });
  }
  const words = section(lines, WORDS_HEADING)?.join("\n").trim() || null;
  return { checklist, words };
}
