/**
 * 各家官方限额 / 用量页。只收核实过、打开后就是用量页的地址。
 *
 * Antigravity 的余量在客户端设置和 CLI `/usage` 里，没有可链的网页。
 * 文档站和 404 的 `/settings` 都不是用量页，这里不给它地址。
 */
const AGENT_USAGE_URLS: Record<string, string> = {
  claude: "https://claude.ai/settings/usage",
  cursor: "https://cursor.com/dashboard/usage",
  codex: "https://chatgpt.com/codex/cloud/settings/analytics#usage",
  grok: "https://grok.com/?_s=usage",
};

export function agentUsageUrl(id: string): string | null {
  return AGENT_USAGE_URLS[id] ?? null;
}

/** 进度条链接的无障碍名称。界面文案用英文，名称跟卡片上的显示名走。 */
export function agentUsageLabel(name: string, detail?: string) {
  return detail ? `${name} usage, ${detail}` : `${name} usage`;
}
