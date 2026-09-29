/**
 * coding agent 模型名的站点规则。视图构建（合计、排名、年度格子）和卡片共用，同构，只放规则。
 *
 * 模型名按来源给的字符串原样分组，**不做跨来源别名合并**：Cursor 报的是它自己的路由名，
 * 和 Claude Code / Codex 的模型 id 不同名，是已知限制。各来源自己的方言（Antigravity 的占位符
 * → catalog id）由来源在上报前解好。
 */

/**
 * 不进排名、不当模型名展示的占位名。
 *
 * - `""`、`unknown`：来源没拿到模型名；`codex-auto-review`：Codex 日志里不是真模型的内部名；
 * - `<synthetic>`：Claude Code 自己合成的消息（接口报错、中断之类）在日志里用的模型名。
 *   这些消息是零用量、不进账本，但活动里「最近一条事件的模型」可能正是它，不能拿去当模型名。
 */
export const HIDDEN_CODING_MODELS: ReadonlySet<string> = new Set(["", "unknown", "codex-auto-review", "<synthetic>"]);

/** 能进排名、能当模型名展示的名字 */
export function isVisibleCodingModel(model: string | null | undefined): model is string {
  return typeof model === "string" && !HIDDEN_CODING_MODELS.has(model);
}
