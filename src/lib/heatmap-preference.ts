/**
 * 联系卡热力图 Tokens / Commit。记在 localStorage，进页前用 layout 里那段
 * 内联脚本写到 `html[data-heatmap]`，首帧就能对上，不必等 React 水合。
 *
 * 两个取值就叫 "tokens" / "commit"：localStorage 值、`data-heatmap`、面板和
 * 页签的 data-* 属性、React 状态全线同一套词 —— 从前 React 侧另叫
 * "coding" / "github"，每过一层翻一次，对着 DOM 调试时对不上号。
 */

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
    // 无痕模式写不进去就当没记住
  }
  applyDocument(mode);
  for (const listener of listeners) listener();
}

export function subscribeHeatmap(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  /*
   * 别的标签页改了偏好：先把新值落到 <html> 上再通知。readHeatmapMode 优先
   * 读 dataset，不落的话快照读到的还是旧值，这个事件等于白订 —— 面板显隐
   * 又是纯 CSS 跟 `html[data-heatmap]` 走的，dataset 不动界面就不动。
   */
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
