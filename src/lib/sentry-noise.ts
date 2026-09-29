/**
 * 站点服务端 Sentry Logs 里不该进的东西。函数里的 console 警告与报错都会被
 * consoleLoggingIntegration 转成日志（src/sentry.server.config.ts），其中有些不是站点的事。
 *
 * 只收「一眼就知道与站点无关、又稳定重复」的，别把这里当筛子用：真正的降级提示
 * （比如 `[pulse-score]`、`[github-repo]` 那几条 console.warn）本来就是要进日志的。
 */
const NOISE_MARKERS = [
  // Node 在每个函数实例冷启动时打一次的实验特性提示，来自运行时自己。一周 50 多条，
  // 全记成 error 级，按 error 过滤日志排查线上问题时把真正的报错淹在里面。
  "ExperimentalWarning: vm.USE_MAIN_CONTEXT_DEFAULT_LOADER",
] as const;

export function isKnownLogNoise(message: string): boolean {
  return NOISE_MARKERS.some((marker) => message.includes(marker));
}
