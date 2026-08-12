/**
 * 克制的日志。
 *
 * 这东西常年跑着，站点重部署、Mac 睡觉导致凭据过期都是常事，每分钟把同一条
 * 「连接被拒绝」写进 docker logs 只会把真正有用的东西冲掉。所以同一个环节
 * 连续出错只在第一次和恢复时各说一句，中间退避着报。
 *
 * 和 emby-reporter 那份是一样的东西。没有抽成公共包：两个上报器各自是独立的
 * 部署单元，各拷一份三十行，比为它们建一个要一起版本管理的包省事。
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

  // 第一次必报；之后按 1、10、100…这样退避着报，久挂时也不至于彻底静音
  if (count === 1 || count % 10 === 0) {
    console.error(`${stamp()} [${scope}] ${reason}${count > 1 ? `（连续第 ${count} 次）` : ""}`);
  }
}

export function recovered(scope: string) {
  if (!streaks.get(scope)) return;
  console.log(`${stamp()} [${scope}] 恢复正常`);
  streaks.delete(scope);
}
