/**
 * 克制的日志。
 *
 * 这东西在 NAS 上常年跑着，上游重启、站点重部署都是常事，同一条
 * 「连接被拒绝」反复写进 docker logs 只会把真正有用的东西冲掉。所以同一个环节
 * 连续出错只在第一次和恢复时各说一句，中间按次数退避着报。
 *
 * 两份上报器各拷这一份，不抽公共包：各自是独立的部署单元，三十行拷过去
 * 比为它们建一个要一起版本管理的包省事。
 */

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

  // 第一次必报；之后每满 10 次再报一次（第 10、20、30…次），久挂时也不至于彻底静音
  if (count === 1 || count % 10 === 0) {
    console.error(`${stamp()} [${scope}] ${reason}${count > 1 ? `（连续第 ${count} 次）` : ""}`);
  }
}

export function recovered(scope: string) {
  if (!streaks.get(scope)) return;
  console.log(`${stamp()} [${scope}] 恢复正常`);
  streaks.delete(scope);
}
