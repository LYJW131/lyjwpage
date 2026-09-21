/**
 * 首屏资源 load 完之前，首屏之外的图保持原来的 lazy（或 next/image 的默认）。
 * load 之后翻成 true，剩下的图一次性改成 eager，不再等滚进视口。
 *
 * 用模块级状态而不是 Context：图散落在各张卡里，挂一个外部 store 就都能订到，
 * 也不必为了这一下把整页包进客户端 Provider。
 */
let restReady = false;
const listeners = new Set<() => void>();

export function isRestReady(): boolean {
  return restReady;
}

export function subscribeRestReady(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 首屏 load 之后调用一次。重复调用不再通知。 */
export function markRestReady(): void {
  if (restReady) return;
  restReady = true;
  for (const listener of listeners) listener();
}

/** 单测把模块状态拨回去。生产代码不调用。 */
export function resetRestReadyForTests(): void {
  restReady = false;
  listeners.clear();
}

export type ImageLoading = "eager" | "lazy";

/**
 * 决定传给 next/image 的 `loading`。
 *
 * - `priority` 时什么都不传：next 自己会预载，再带 loading 会冲突。
 * - 首屏还没完：原样交回去。不传就继续走 next 的默认（视口内的马上拉，
 *   data URI 不挂 lazy）。
 * - 首屏完了：一律 eager，包含原来写明 lazy 的那些。横滑出屏的封面也在这一档。
 */
export function resolveImageLoading(
  restReadyNow: boolean,
  loading: ImageLoading | undefined,
  priority: boolean | undefined,
): { loading?: ImageLoading } {
  if (priority) return {};
  if (!restReadyNow) return loading ? { loading } : {};
  return { loading: "eager" };
}
