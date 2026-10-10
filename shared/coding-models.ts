export const HIDDEN_CODING_MODELS: ReadonlySet<string> = new Set(["", "unknown", "codex-auto-review", "<synthetic>"]);

// 上下文档位标记（Claude Code 的 `claude-opus-5-5[1m]`）不是另一个模型，合计与排名并进基础名。
const CONTEXT_MARKER = /\[\d+[km]\]$/i;

export function codingModelName(model: string): string {
  return model.replace(CONTEXT_MARKER, "");
}

export function isVisibleCodingModel(model: string | null | undefined): model is string {
  return typeof model === "string" && !HIDDEN_CODING_MODELS.has(model);
}
