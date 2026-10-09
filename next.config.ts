import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";
import { execSync } from "node:child_process";

import { IMAGE_PATH_PREFIX } from "./src/lib/asset-url";
import { MCP_PATH } from "./shared/mcp";
import { previewWorkerOrigin } from "./scripts/preview-worker-name.mjs";

// 不可放宽成任意路径代理，否则整个 R2 桶都会暴露在站点域名下。
const R2_ORIGIN = process.env.R2_PUBLIC_BASE_URL?.replace(/\/+$/, "") ?? "";
const IMAGE_REWRITE_SOURCE = `${IMAGE_PATH_PREFIX}/:objectKey([a-f0-9]{64}\\.(?:png|webp|jpe?g))`;

// 构建时间必须在配置求值时内联；服务端模块求值会把它变成冷启动时间。
const BUILD_TIME = new Date().toISOString();

function resolvePublicBackendUrl(): string | undefined {
  const configured = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (process.env.VERCEL_ENV !== "preview") return configured;
  const waited = process.env.PREVIEW_BACKEND_URL;
  if (waited !== undefined) return waited || configured;
  return previewWorkerOrigin(process.env.VERCEL_GIT_COMMIT_REF ?? "") ?? configured;
}

function resolveCommitSha(): string {
  const fromVercel = process.env.VERCEL_GIT_COMMIT_SHA;
  if (fromVercel) return fromVercel;
  try {
    return execSync("git rev-parse HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

const nextConfig: NextConfig = {
  env: {
    BUILD_TIME,
    COMMIT_SHA: resolveCommitSha(),
    NEXT_PUBLIC_BACKEND_URL: resolvePublicBackendUrl(),
    SENTRY_ENVIRONMENT: process.env.VERCEL_ENV ?? "development",
  },
  // Next 按 distDir 加锁；并行本地实例必须使用不同目录。
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Cache Components 会拒绝包括 runtime="nodejs" 在内的旧式段配置。
  cacheComponents: true,
  // 默认名单含 Lighthouse，命中会让首页绕过 ISR 整页动态渲染；哨兵正则永不匹配。
  htmlLimitedBots: /^\b\B$/,
  // 307 保留 POST 与请求体；不用 rewrite：经 Vercel 代理后 Worker 只看得到 Vercel 出口 IP，按 IP 限流会让所有人共用一个桶。
  async redirects() {
    const backend = resolvePublicBackendUrl()?.replace(/\/+$/, "");
    return backend ? [{ source: MCP_PATH, destination: `${backend}${MCP_PATH}`, permanent: false }] : [];
  },
  async rewrites() {
    const explainer = { source: "/explainer", destination: "/explainer/index.html" };
    if (!R2_ORIGIN) return [explainer];
    return [explainer, { source: IMAGE_REWRITE_SOURCE, destination: `${R2_ORIGIN}/:objectKey` }];
  },
  async headers() {
    return [
      {
        source: "/explainer/a/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        // 显式启用 rewrite 缓存，避免缓存行为依赖控制台的隐式开关。
        source: `${IMAGE_PATH_PREFIX}/:path*`,
        headers: [{ key: "x-vercel-enable-rewrite-caching", value: "1" }],
      },
      {
        // 必须覆盖预渲染的长期缓存头，否则下游缓存会一直返回旧版本号。
        source: "/api/version",
        headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
      {
        // 首页没有静态后缀，缺少此头时 ESA 会每次回源。
        // 注意别加 must-revalidate：它禁止返回过期缓存，和 SWR 的目标正好相反。
        source: "/",
        headers: [
          { key: "Cache-Control", value: "public, max-age=300, stale-while-revalidate=86400, stale-if-error=86400" },
        ],
      },
    ];
  },
  // pnpm 的真实字体路径会被追踪，但运行时没有软链；必须同时打包代码读取的路径。
  outputFileTracingIncludes: {
    "/opengraph-image": [
      "node_modules/geist/dist/fonts/geist-mono/GeistMono-Regular.ttf",
      "node_modules/geist/dist/fonts/geist-mono/GeistMono-Bold.ttf",
    ],
  },
  allowedDevOrigins: ["test.lyjw.dev", "127.0.0.1"],
  images: {
    // 仅为无法按尺寸取图的源开放优化器；预签名 URL 必须允许查询串。
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.blobstore.apple.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "psn-rsc.prod.dl.playstation.net",
        pathname: "/**",
      },
    ],
    // fake-IP 代理会触发 Next 的 SSRF 拦截；仅开发或明确使用该代理的自建环境放行。
    dangerouslyAllowLocalIP: process.env.NODE_ENV === "development" || process.env.IMAGE_ALLOW_LOCAL_IP === "true",
  },
};

// 隧道路径必须稳定：下游缓存里的旧 JS 仍会向上一版路径上报。
export default withSentryConfig(nextConfig, {
  org: "yangjunwei-liang",
  project: "lyjwpage",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  telemetry: false,
  tunnelRoute: "/relay",
  widenClientFileUpload: true,
  sourcemaps: { deleteSourcemapsAfterUpload: true },
  bundleSizeOptimizations: {
    excludeDebugStatements: true,
    excludeReplayIframe: true,
    excludeReplayShadowDom: true,
  },
});
