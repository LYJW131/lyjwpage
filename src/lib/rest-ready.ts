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

export function markRestReady(): void {
  if (restReady) return;
  restReady = true;
  for (const listener of listeners) listener();
}

export function resetRestReadyForTests(): void {
  restReady = false;
  listeners.clear();
}

export type ImageLoading = "eager" | "lazy";

export function resolveImageLoading(
  restReadyNow: boolean,
  loading: ImageLoading | undefined,
  priority: boolean | undefined,
): { loading?: ImageLoading } {
  if (priority) return {};
  if (!restReadyNow) return loading ? { loading } : {};
  return { loading: "eager" };
}
