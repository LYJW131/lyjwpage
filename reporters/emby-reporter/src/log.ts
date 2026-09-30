const streaks = new Map<string, number>();

function stamp() {
  return new Date().toISOString();
}

export function info(message: string) {
  console.log(`${stamp()} ${message}`);
}

export function failure(scope: string, error: unknown) {
  const count = (streaks.get(scope) ?? 0) + 1;
  streaks.set(scope, count);
  const reason = error instanceof Error ? error.message : String(error);

  if (count === 1 || count % 10 === 0) {
    console.error(`${stamp()} [${scope}] ${reason}${count > 1 ? `（连续第 ${count} 次）` : ""}`);
  }
}

export function recovered(scope: string) {
  if (!streaks.get(scope)) return;
  console.log(`${stamp()} [${scope}] 恢复正常`);
  streaks.delete(scope);
}
