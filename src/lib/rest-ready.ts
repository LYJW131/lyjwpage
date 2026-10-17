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
