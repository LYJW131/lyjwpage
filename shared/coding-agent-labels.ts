// 各端共用的 agent 显示名，一个事实一个出处；没登记的 id 原样显示。
export const CODING_AGENT_LABELS: Record<string, string> = {
  claude: "Claude Code",
  cursor: "Cursor",
  codex: "Codex",
  grok: "Grok Build",
  antigravity: "Antigravity",
  opencode: "OpenCode",
  pi: "Pi",
  devin: "Devin CLI",
};

export function codingAgentLabel(id: string): string {
  return Object.hasOwn(CODING_AGENT_LABELS, id) ? CODING_AGENT_LABELS[id]! : id;
}
