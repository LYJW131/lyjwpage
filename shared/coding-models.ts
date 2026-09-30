export const HIDDEN_CODING_MODELS: ReadonlySet<string> = new Set(["", "unknown", "codex-auto-review", "<synthetic>"]);

export function isVisibleCodingModel(model: string | null | undefined): model is string {
  return typeof model === "string" && !HIDDEN_CODING_MODELS.has(model);
}
