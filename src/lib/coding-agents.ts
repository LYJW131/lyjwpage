/**
 * coding agent 的站点登记表与卡片行的装配。同构、只放纯逻辑：浏览器、单测都能用。
 *
 * 来源只报自己观测到的事实，agent 只给 id（AGENTS.md「API 命名与跨端契约」的设计契约）；
 * 展示名、品牌图标、在卡片上占哪种行只在这张表里定。用量视图、此刻、限额三份数据按 id
 * 并成一行，行上的结论（灯、模型名、来源状况）也在这里算，卡片只管画。
 */

import { CODING_USAGE_SOURCES } from "@shared/coding-usage-sources";

import type {
  CodingNowPayload,
  CodingUsageAgentView,
  CodingUsagePayload,
  CodingUsageSource,
} from "./types.ts";
import { agentLimitsOf, type AgentLimitFields, type AgentLimitsPayload } from "./vibecoding-limits.ts";

/**
 * 行的种类：`featured` 画全量面板（今日用量 + 固定几条限额），`compact` 只占一行紧凑行
 * （最紧的那条限额），`hidden` 进合计与年度、不单独占一行。
 */
export type CodingAgentRowKind = "featured" | "compact" | "hidden";

export type CodingAgentBrand = {
  label: string;
  /** 品牌图标键，卡片按它取矢量；认不出的键退回首字母 */
  icon: string;
  row: CodingAgentRowKind;
};

/**
 * 登记顺序就是行的顺序：全量面板、紧凑行都按这里排在前面。
 *
 * 全量面板的限额是按各家窗口写死的几行（卡片 vibecoding-card 的 FEATURED_LIMITS），`featured`
 * 的 agent 要在那里有一项。选谁进全量面板看限额有几条：Codex 只剩一条周额度，挤在三行的面板里
 * 两行空着；Cursor 正好有自家模型、其他模型、Grok Bot 三条。
 */
export const CODING_AGENTS = {
  claude: { label: "Claude Code", icon: "anthropic", row: "featured" },
  cursor: { label: "Cursor", icon: "cursor", row: "featured" },
  codex: { label: "Codex", icon: "openai", row: "compact" },
  grok: { label: "Grok Build", icon: "grok", row: "compact" },
  antigravity: { label: "Antigravity", icon: "antigravity", row: "compact" },
  opencode: { label: "OpenCode", icon: "opencode", row: "hidden" },
  pi: { label: "Pi", icon: "pi", row: "hidden" },
} as const satisfies Record<string, CodingAgentBrand>;

const REGISTERED = Object.keys(CODING_AGENTS);

/**
 * 登记表里没有的 id：展示名就是 id、首字母图标、占一行紧凑行。上报器新配一个 agent，
 * 页面上立刻就该有一行，登记是后补的事。
 */
export function codingAgentBrand(id: string): CodingAgentBrand {
  return Object.hasOwn(CODING_AGENTS, id) ? CODING_AGENTS[id as keyof typeof CODING_AGENTS] : { label: id, icon: id, row: "compact" };
}

/** 来源在界面上的名字 */
export const CODING_SOURCE_LABELS: Record<CodingUsageSource, string> = {
  mac: "Mac",
  agents: "Account",
  "agents-otlp": "Cloud",
};

export type CodingActivityEntry = CodingNowPayload["agents"][number]["activity"][number];

export type CodingAgentRow = CodingAgentBrand &
  AgentLimitFields & {
    id: string;
    /** 用量视图里这个 agent 那一行；还没有用量事实时为 null（未知，不是 0） */
    usage: CodingUsageAgentView | null;
    /** 各来源最近一条用量事件，时刻降序；从没见过为空 */
    activity: CodingActivityEntry[];
  };

/**
 * 三份数据按 id 并成卡片的行。只在其中一份出现的 id 也有一行（只有限额、只有此刻），
 * 缺的那份如实为空，不伪造零用量。登记表里的按登记顺序在前，其余按 id。
 */
export function codingAgentRows(
  usage: Pick<CodingUsagePayload, "agents"> | null,
  now: Pick<CodingNowPayload, "agents"> | null,
  limits: AgentLimitsPayload | null,
): CodingAgentRow[] {
  const usageById = new Map((usage?.agents ?? []).map((agent) => [agent.id, agent]));
  const activityById = new Map((now?.agents ?? []).map((agent) => [agent.id, agent.activity]));
  const ids = new Set([...usageById.keys(), ...activityById.keys(), ...Object.keys(limits?.agents ?? {})]);
  const rank = (id: string) => {
    const index = REGISTERED.indexOf(id);
    return index === -1 ? REGISTERED.length : index;
  };
  return [...ids]
    .sort((left, right) => rank(left) - rank(right) || left.localeCompare(right))
    .map((id) => ({
      id,
      ...codingAgentBrand(id),
      ...agentLimitsOf(limits, id),
      usage: usageById.get(id) ?? null,
      activity: [...(activityById.get(id) ?? [])].sort((left, right) => right.lastActivityAt - left.lastActivityAt),
    }));
}

/**
 * 活动灯看哪条：各来源最近一条事件里最新的那条。Mac 亲口离线（优雅离开）时只来自 `mac`
 * 的时刻立即作废，账号、云端的不受影响。亮不亮 = 它离此刻在不在 `CODING_ACTIVE_WINDOW_MS`
 * 内，由卡片按钟判；Mac 崩溃、断网时它的时刻不再前进，窗口到点自己灭。
 */
export function liveCodingActivity(activity: readonly CodingActivityEntry[], macDeclaredOffline: boolean): CodingActivityEntry | null {
  return activity.find((entry) => !(macDeclaredOffline && entry.source === "mac")) ?? null;
}

/**
 * 最近一次用量事件过去多久还算「在用」。各来源在用时约一分钟来一封新时刻，窗口比间隔宽，
 * 连续在用时灯不闪。
 */
export const CODING_ACTIVE_WINDOW_MS = 5 * 60_000;

/**
 * 行上显示的模型名：灯亮着就是亮着那条的模型；否则最近一条带模型的事件；都没有就用量视图里
 * 最近一个有用量的日子的主力模型。
 */
export function codingDisplayModel(row: Pick<CodingAgentRow, "activity" | "usage">, live: CodingActivityEntry | null, active: boolean): string | null {
  return (active ? live?.model : null) ?? row.activity.find((entry) => entry.model)?.model ?? row.usage?.latestModel ?? null;
}

/** 某个来源对这个 agent 的状况，给卡片写说明用 */
export type CodingSourceNote = { source: CodingUsageSource; label: string; state: CodingUsageAgentView["status"][number]["state"]; error: string | null; warning: string | null };

/**
 * 这一行的用量能不能当完整值看。参与合计的来源这一轮采集失败（`error`）时，它的日子停在失败前，
 * 用量只含其余来源和它的旧账：`failing` 列出这些来源，卡片据此标出来，不把缺的那部分当 0。
 * `notes` 是全部来源的状况，给悬停说明用：`superseded` 是被账号级来源覆盖、不参与合计（不是故障），
 * `conflict` 是同一 agent 配了两个账号级来源、登记在后的那个不算（合计仍是完整的一份）。
 */
export function codingSourceHealth(usage: CodingUsageAgentView | null): { failing: CodingSourceNote[]; notes: CodingSourceNote[] } {
  const notes = (usage?.status ?? []).map((status) => ({
    source: status.source,
    label: CODING_SOURCE_LABELS[status.source] ?? status.source,
    state: status.state,
    error: status.error,
    warning: status.warning,
  }));
  return { failing: notes.filter((note) => note.state === "error"), notes };
}

/** 悬停说明：每个来源一句，例 `Mac: counted` / `Mac: covered by Account` / `Account: failed to update — 401` */
export function describeCodingSources(notes: readonly CodingSourceNote[]): string {
  const account = notes.find((note) => note.state !== "conflict" && CODING_USAGE_SOURCES[note.source]?.scope === "account");
  return notes
    .map((note) => {
      switch (note.state) {
        case "ok":
          return `${note.label}: counted${note.warning ? ` (${note.warning})` : ""}`;
        case "error":
          return `${note.label}: failed to update${note.error ? ` — ${note.error}` : ""}`;
        case "superseded":
          return `${note.label}: covered by ${account?.label ?? "account history"}`;
        case "conflict":
          return `${note.label}: ignored (duplicate account source)`;
      }
    })
    .join("\n");
}
