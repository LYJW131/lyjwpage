export const WORKERS = ["core", "ai", "site", "ingress", "collector"] as const;
export type Worker = (typeof WORKERS)[number];
export type WatchPaths = { include: readonly string[]; exclude: readonly string[] };

const ROOT_MANIFESTS = ["tsconfig.json", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"];
const AI_ONLY_SHARED = ["shared/god-chat.ts", "shared/god-chat-tiers.ts", "shared/github-issue.ts", "shared/build-routine.ts", "shared/mcp.ts"];
const SITE_PATHS = [
  "src/*",
  "shared/*",
  "workers/site/*",
  "scripts/*",
  "public/*",
  "docs/explainer/v2/*",
  "wrangler.jsonc",
  "vite.config.ts",
  "react-router.config.ts",
  ...ROOT_MANIFESTS,
];

// 契约：这两张表是 Cloudflare Workers Builds 控制台配置的仓库内副本，控制台不读它们；
// 哪边先改都要同步另一边并读回核对（docs/workers-builds.md「构建监视路径」）。
export const BUILD_WATCH_PATHS: Record<Worker, WatchPaths> = {
  core: {
    include: ["workers/core/*", "shared/*", ...ROOT_MANIFESTS, "scripts/preview-*"],
    exclude: ["shared/ingest/*", ...AI_ONLY_SHARED],
  },
  ai: {
    include: [
      "workers/ai/*",
      "shared/ai-paths.ts",
      ...AI_ONLY_SHARED,
      "shared/chat-time.ts",
      "shared/coding-models.ts",
      "shared/coding-usage-sources.ts",
      "shared/coding-usage-view.ts",
      "shared/coding-year.ts",
      "shared/github-chart-compact.ts",
      "shared/heatmap-window.ts",
      "shared/http-origins.ts",
      "shared/mcp-auth.ts",
      "shared/private-history.ts",
      "shared/public-status.ts",
      "shared/status-views.ts",
      "shared/site.ts",
      "shared/asset-url.ts",
      "shared/json.ts",
      "shared/sha256.ts",
      ...ROOT_MANIFESTS,
      "scripts/preview-*",
    ],
    exclude: [],
  },
  site: { include: [...SITE_PATHS, ".github/github-avatar.sha256"], exclude: [] },
  ingress: { include: ["workers/ingress/*", "shared/*", ...ROOT_MANIFESTS], exclude: AI_ONLY_SHARED },
  collector: { include: ["workers/collector/*", "shared/*", ...ROOT_MANIFESTS], exclude: AI_ONLY_SHARED },
};

// 非 main 分支只有 core、site 会构建（Builds Previews）；ai、ingress、collector 关着分支构建，PR 上不会有它们的检查。
// core 的 Preview 同时跑 ai 与给 site 预览当后端，所以比生产宽。
export const PREVIEW_WATCH_PATHS: Partial<Record<Worker, WatchPaths>> = {
  core: { include: [...SITE_PATHS, "workers/core/*", "workers/ai/*"], exclude: ["shared/ingest/*"] },
  site: { include: SITE_PATHS, exclude: [] },
};

// Cloudflare 的规则：路径相对仓库根，`*` 匹配任意个字符（含 `/`）；先剔除命中排除的，剩下的再看包含。
function pattern(rule: string) {
  return new RegExp(`^${rule.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
}

export function watches(paths: WatchPaths, file: string) {
  if (paths.exclude.some((rule) => pattern(rule).test(file))) return false;
  return paths.include.some((rule) => pattern(rule).test(file));
}

export function workersFor(files: readonly string[], table: Partial<Record<Worker, WatchPaths>>): Worker[] {
  return WORKERS.filter((worker) => {
    const paths = table[worker];
    return paths !== undefined && files.some((file) => watches(paths, file));
  });
}
