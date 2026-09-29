/**
 * 站点服务端 Sentry Logs 里不该进的东西。函数里的 console 警告与报错都会被
 * consoleLoggingIntegration 转成日志（src/sentry.server.config.ts），其中有些不是站点的事。
 *
 * 只收「一眼就知道与站点无关、又稳定重复」的，别把这里当筛子用：真正的降级提示
 * （比如 `[pulse-score]`、`[github-repo]` 那几条 console.warn）本来就是要进日志的。
 *
 * 整条消息都要对上 Node 警告的完整格式（首尾锚定），不能只是「包含」那句话 ——
 * 否则一条真的错误日志只要把这句警告原文引在里面（比如报错信息里带着 stderr 输出）
 * 也会被一并吞掉。
 */
const NOISE_PATTERNS = [
  // Node 在每个函数实例冷启动时打一次的实验特性提示，来自运行时自己。一周 50 多条，
  // 全记成 error 级，按 error 过滤日志排查线上问题时把真正的报错淹在里面。
  // 尾巴那句 `(Use ...)` 在 stderr 里是换行接上的，进日志后有的是换行、有的是空格，都收。
  /^\s*\(node:\d+\) ExperimentalWarning: vm\.USE_MAIN_CONTEXT_DEFAULT_LOADER is an experimental feature and might change at any time(?:\s+\(Use `node --trace-warnings \.\.\.` to show where the warning was created\))?\s*$/,
] as const;

export function isKnownLogNoise(message: string): boolean {
  return NOISE_PATTERNS.some((pattern) => pattern.test(message));
}
