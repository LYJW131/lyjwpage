/**
 * 前台应用算不算「在写代码」。Pulse 的 Coding 道把它记进原始观测
 * （`desktop.coding`），三色带和 Jev 都从那里读。
 */
/**
 * 已知的 coding 应用。id 从 desktop-app-overrides 抄过来，再补上编辑器 / 终端；
 * 不从 .tsx 引用，避免把 React 拖进 Worker 和纯函数测试。
 */
const CODING_BUNDLE_IDS = new Set([
  "com.todesktop.230313mzl4w4u92",
  "com.mitchellh.ghostty",
  "com.microsoft.VSCode",
  "com.apple.dt.Xcode",
  "dev.zed.Zed",
  "com.apple.Terminal",
  "com.googlecode.iterm2",
  "dev.warp.Warp-Stable",
]);

export function isCodingApp(
  bundleIdentifier: string | null | undefined,
  applicationName: string | null | undefined,
): boolean {
  const id = bundleIdentifier?.trim() ?? "";
  if (id) {
    if (CODING_BUNDLE_IDS.has(id)) return true;
    const lower = id.toLowerCase();
    if (id.includes("230313mzl4w4u92") || lower.includes("cursor")) return true;
    if (lower.includes("antigravity")) return true;
    if (lower.includes("ghostty")) return true;
    if (lower.startsWith("com.jetbrains.")) return true;
    if (
      lower.includes("claude-code") ||
      lower.includes("claudecode") ||
      lower.includes("claude.code") ||
      lower.includes("com.anthropic.claude") ||
      lower.includes("claude")
    ) {
      return true;
    }
  }
  const name = applicationName?.trim().toLowerCase() ?? "";
  if (!name) return false;
  return (
    name.includes("cursor") ||
    name.includes("antigravity") ||
    name.includes("ghostty") ||
    name.includes("claude") ||
    name === "code" ||
    name === "visual studio code" ||
    name === "xcode" ||
    name === "zed" ||
    name === "terminal" ||
    name === "iterm" ||
    name === "iterm2" ||
    name === "warp"
  );
}
