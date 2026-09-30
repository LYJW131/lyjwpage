const NOISE_PATTERNS = [
  // Node 在每个函数实例冷启动时打一次的实验特性提示，来自运行时自己。
  // 全记成 error 级，按 error 过滤日志排查线上问题时把真正的报错淹在里面。
  // 尾巴那句 `(Use ...)` 在 stderr 里是换行接上的，进日志后有的是换行、有的是空格，都收。
  /^\s*\(node:\d+\) ExperimentalWarning: vm\.USE_MAIN_CONTEXT_DEFAULT_LOADER is an experimental feature and might change at any time(?:\s+\(Use `node --trace-warnings \.\.\.` to show where the warning was created\))?\s*$/,
] as const;

export function isKnownLogNoise(message: string): boolean {
  return NOISE_PATTERNS.some((pattern) => pattern.test(message));
}
