import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { config } from "./config.js";
import type { AgentLimit, AgentRow } from "./site.js";

const run = promisify(execFile);

/**
 * Antigravity 的限额直接问 `agy` 自己：`agy -p /usage` 在 print 模式里会展开
 * 斜杠命令，打出四行制表符分隔的用量（实测 2026-09-05）：
 *
 *     Gemini Models\tWeekly Limit Remaining\t97%\t2026-09-10T22:45:09Z
 *     Gemini Models\tFive Hour Limit Remaining\t81%\t2026-09-05T04:51:12Z
 *     Claude and GPT models\tWeekly Limit Remaining\t100%\t2026-09-12T00:46:22Z
 *     Claude and GPT models\tFive Hour Limit Remaining\t100%\t2026-09-05T05:46:22Z
 *
 * 给的是**剩余**，站点要的是已用，这里翻成 100 - 剩余。
 * TokenTracker 那条路要问本机 IDE 进程，容器里走不通；CLI 登录态在 HOME 下的
 * `.gemini/antigravity-cli/` 里，过期由 CLI 自己刷新，上报器不碰凭据文件。
 *
 * 不认识的行一律跳过：格式变了就是这一行没了，不是整封坏掉。
 */
const WINDOWS: Array<{ match: RegExp; minutes: number; label: string }> = [
  { match: /five hour/i, minutes: 300, label: "5h" },
  { match: /weekly/i, minutes: 10_080, label: "Weekly" },
];

function bucketLabel(bucket: string): string {
  const trimmed = bucket.trim();
  if (/^gemini/i.test(trimmed)) return "Gemini";
  if (/claude/i.test(trimmed) && /gpt/i.test(trimmed)) return "Claude & GPT";
  return trimmed.replace(/\s+models?$/i, "");
}

export function parseAgyUsage(stdout: string): AgentLimit[] {
  const slots = ["primary", "secondary", "tertiary", "quaternary"];
  const limits: AgentLimit[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const fields = line.split("\t").map((field) => field.trim());
    if (fields.length < 4) continue;
    const [bucket, windowName, remainingText, resetText] = fields;
    const window = WINDOWS.find((entry) => entry.match.test(windowName ?? ""));
    const remaining = Number((remainingText ?? "").replace("%", ""));
    if (!window || !Number.isFinite(remaining)) continue;
    const resetMs = Date.parse(resetText ?? "");
    const slot = slots[limits.length];
    if (!slot) break;
    limits.push({
      key: `antigravity.${slot}`,
      label: `${bucketLabel(bucket ?? "")} ${window.label}`,
      group: null,
      windowMinutes: window.minutes,
      usedPercent: Math.min(100, Math.max(0, 100 - remaining)),
      resetsAt: Number.isFinite(resetMs) ? Math.trunc(resetMs / 1000) : null,
    });
  }
  return limits;
}

/**
 * 跑一次 `agy -p /usage`。CLI 没装、没登录、超时都变成 limitsError 那一行 ——
 * 「配了但取不到」，站点据此画 Unavailable；只有 CLI 压根不存在时才当「没配」不发。
 */
export async function fetchAntigravityViaCli(): Promise<AgentRow | null> {
  try {
    const { stdout } = await run(
      config.agyBin,
      ["-p", "/usage", "--output-format", "text", "--print-timeout", "90s"],
      {
        env: { ...process.env, HOME: config.home },
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
      },
    );
    const limits = parseAgyUsage(stdout);
    if (limits.length === 0) {
      return {
        id: "antigravity",
        plan: null,
        limits: [],
        limitsError: "agy /usage 没有输出可解析的限额行，多半是没登录",
      };
    }
    return { id: "antigravity", plan: null, limits, limitsError: null };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // 二进制不存在 = 这家没配，不发这一行
    if (code === "ENOENT") return null;
    const message = error instanceof Error ? error.message : String(error);
    return {
      id: "antigravity",
      plan: null,
      limits: [],
      limitsError: `agy /usage 失败：${message.split("\n")[0]}`,
    };
  }
}
