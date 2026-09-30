
export const HEATMAP_STORAGE_KEY = "heatmap";

export type HeatmapMode = "tokens" | "commit";

const listeners = new Set<() => void>();

function coerce(value: string | null | undefined): HeatmapMode {
  return value === "commit" ? "commit" : "tokens";
}

function applyDocument(value: HeatmapMode) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.heatmap = value;
}

export function readHeatmapMode(): HeatmapMode {
  if (typeof document !== "undefined" && document.documentElement.dataset.heatmap) {
    return coerce(document.documentElement.dataset.heatmap);
  }
  try {
    return coerce(localStorage.getItem(HEATMAP_STORAGE_KEY));
  } catch {
    return "tokens";
  }
}

export function writeHeatmapMode(mode: HeatmapMode) {
  try {
    localStorage.setItem(HEATMAP_STORAGE_KEY, mode);
  } catch {
  }
  applyDocument(mode);
  for (const listener of listeners) listener();
}

export function subscribeHeatmap(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  // 先更新 dataset 再通知；快照优先读 dataset，反序会让跨标签偏好变化失效。
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== HEATMAP_STORAGE_KEY) return;
    applyDocument(coerce(event.newValue));
    onStoreChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStorage);
  };
}
