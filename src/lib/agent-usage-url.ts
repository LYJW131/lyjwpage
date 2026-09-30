const AGENT_USAGE_URLS: Record<string, string> = {
  claude: "https://claude.ai/settings/usage",
  cursor: "https://cursor.com/dashboard/spending",
  codex: "https://chatgpt.com/codex/cloud/settings/analytics#usage",
  grok: "https://grok.com/?_s=usage",
};

export function agentUsageUrl(id: string): string | null {
  return AGENT_USAGE_URLS[id] ?? null;
}

export function agentUsageLabel(name: string, detail?: string) {
  return detail ? `${name} usage, ${detail}` : `${name} usage`;
}
