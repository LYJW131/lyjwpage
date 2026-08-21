/**
 * 联系卡热力图 Tokens / Commit。记在 localStorage，进页前用 layout 里那段
 * 内联脚本写到 `html[data-heatmap]`，首帧就能对上，不必等 React 水合。
 */

export const HEATMAP_STORAGE_KEY = "heatmap";

export type HeatmapMode = "coding" | "github";

const listeners = new Set<() => void>();

function applyDocument(value: "tokens" | "commit") {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.heatmap = value;
}

export function heatmapValue(mode: HeatmapMode): "tokens" | "commit" {
  return mode === "github" ? "commit" : "tokens";
}

export function readHeatmapMode(): HeatmapMode {
  if (typeof document !== "undefined" && document.documentElement.dataset.heatmap === "commit") {
    return "github";
  }
  try {
    return localStorage.getItem(HEATMAP_STORAGE_KEY) === "commit" ? "github" : "coding";
  } catch {
    return "coding";
  }
}

export function writeHeatmapMode(mode: HeatmapMode) {
  const value = heatmapValue(mode);
  try {
    localStorage.setItem(HEATMAP_STORAGE_KEY, value);
  } catch {
    // 无痕模式写不进去就当没记住
  }
  applyDocument(value);
  for (const listener of listeners) listener();
}

export function subscribeHeatmap(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}
