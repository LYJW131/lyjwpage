export type Finding = {
  kind: "bug" | "security";
  severity: "high" | "medium" | "low";
  file: string;
  line: number;
  title: string;
  detail: string;
};

type InlineComment = { path: string; line: number; side: "RIGHT"; body: string };

// 行首标记与 Devin 的写法一致，`scripts/pr-gate/threads.ts#severityOf` 据此分档：🔴 挡合并，🟥 / 🟨 算安全，带 (optional) 的 🟡 可选。
export function mark(item: Pick<Finding, "kind" | "severity">): string {
  if (item.kind === "security") return item.severity === "low" ? "🟨" : "🟥";
  if (item.severity === "high") return "🔴";
  return item.severity === "low" ? "🟡 (optional)" : "🟡";
}

// 新版文件里落在 diff hunk 内的行号；行内评论只能挂在这些行上，否则 GitHub 整个评审 422。
export function commentableLines(diff: string): Map<string, Set<number>> {
  const lines = new Map<string, Set<number>>();
  let current: Set<number> | null = null;
  let next = 0;
  for (const text of diff.split("\n")) {
    const file = /^\+\+\+ b\/(.+)$/.exec(text);
    if (file) {
      current = new Set();
      lines.set(file[1], current);
      continue;
    }
    if (text.startsWith("+++ ") || text.startsWith("--- ") || text.startsWith("diff --git")) {
      if (text.startsWith("diff --git")) current = null;
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) {
      next = Number(hunk[1]);
      continue;
    }
    if (!current) continue;
    if (text.startsWith("+") || text.startsWith(" ")) current.add(next++);
  }
  return lines;
}

function flatten(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function reviewPayload(findings: Finding[], commentable: Map<string, Set<number>>) {
  const comments: InlineComment[] = [];
  const unplaced: Finding[] = [];
  for (const item of findings) {
    if (commentable.get(item.file)?.has(item.line)) {
      comments.push({
        path: item.file,
        line: item.line,
        side: "RIGHT",
        body: `${mark(item)} **${flatten(item.title)}**\n\n${item.detail.trim()}`,
      });
    } else {
      unplaced.push(item);
    }
  }
  const lines = [
    "## lyjwpage review",
    "",
    findings.length === 0 ? "**Verdict:** CLEAN" : `**Verdict:** ${findings.length} finding(s)`,
  ];
  for (const item of unplaced) {
    lines.push("", `- ${mark(item)} \`${flatten(item.file)}:${item.line}\` **${flatten(item.title)}**`, `  ${flatten(item.detail)}`);
  }
  return { body: lines.join("\n"), comments };
}
