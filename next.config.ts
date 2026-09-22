import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";
import { execSync } from "node:child_process";

import { IMAGE_PATH_PREFIX } from "./src/lib/asset-url";
import { previewWorkerOrigin } from "./scripts/preview-worker-name.mjs";

/**
 * 页面上的图片是 `/img/<sha256>.<ext>` 同源路径，这里把它代理到 R2。
 *
 * 只在边缘发生：外部 rewrite 由 Vercel 的代理层转发，不进 Function、不过 sharp。
 * R2 对象带 `max-age=31536000, immutable`，配合下面 headers 里那条
 * `x-vercel-enable-rewrite-caching`，Vercel CDN 按这份头缓存，每个区域只回 R2 一次。
 * `lyjw131.com` 那边不经这条：ESA 按静态后缀缓存 `/img/*` 并自己回源。
 *
 * source 写死成「64 位十六进制 + 三种后缀」，和 IMAGE_OBJECT_KEY 一致：别放成
 * `:path*`，那等于把整个桶的任意路径都从站点域名代理出去。
 */
const R2_ORIGIN = process.env.R2_PUBLIC_BASE_URL?.replace(/\/+$/, "") ?? "";
const IMAGE_REWRITE_SOURCE = `${IMAGE_PATH_PREFIX}/:objectKey([a-f0-9]{64}\\.(?:png|webp|jpe?g))`;

/**
 * 页脚那行构建信息。两个值都必须在**构建期**求值、以字面量内联进产物。
 *
 * 别改成在服务端组件里现算 —— 首页的静态壳不是构建期就冻住的：每次上报进来
 * 都会按 tag 失效，下一个请求在服务端重新生成一遍（见下面 cacheComponents
 * 那段）。在模块作用域写 `new Date()`，拿到的是「最后那台实例的冷启动时刻」，
 * 会跟着上报一整天悄悄往前漂，而且页面上看不出来它是错的。
 *
 * 走 `env` 是因为它是 DefinePlugin 式的文本替换：值在构建时焊死，之后无论
 * 冷启动还是重新生成都不会再变。（这个字段的文档标了 legacy，指的是「读配置」
 * 这个用途该用 .env 文件；.env 算不出值，构建期常量还是只能走这里。）
 */
const BUILD_TIME = new Date().toISOString();

/**
 * 生产构建沿用 Vercel 上的 NEXT_PUBLIC_BACKEND_URL。预览构建改连该分支的
 * Worker Preview：`env` 会盖过环境里那份生产地址。main 的预览仍走生产。
 * scripts/build.mjs 会先等 Preview 就绪，把结果放进 PREVIEW_BACKEND_URL；
 * 等不到时是空串，这次构建连生产。
 */
function resolvePublicBackendUrl(): string | undefined {
  const configured = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (process.env.VERCEL_ENV !== "preview") return configured;
  const waited = process.env.PREVIEW_BACKEND_URL;
  if (waited !== undefined) return waited || configured;
  return previewWorkerOrigin(process.env.VERCEL_GIT_COMMIT_REF ?? "") ?? configured;
}

/** Vercel 自动注入完整 sha；本地开发没有这个变量，回退问 git */
function resolveCommitSha(): string {
  const fromVercel = process.env.VERCEL_GIT_COMMIT_SHA;
  if (fromVercel) return fromVercel;
  try {
    return execSync("git rev-parse HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // 拿不到就留空（浅克隆、tarball 部署），页脚那一段整个不显示
    return "";
  }
}

const nextConfig: NextConfig = {
  env: {
    BUILD_TIME,
    COMMIT_SHA: resolveCommitSha(),
    NEXT_PUBLIC_BACKEND_URL: resolvePublicBackendUrl(),
    // Sentry 按部署类型分环境（见 lib/sentry）；本地 development 默认不上报
    SENTRY_ENVIRONMENT: process.env.VERCEL_ENV ?? "development",
  },
  /**
   * `next dev` 按 `<distDir>/dev/lock` 保证同一目录只跑一个实例。3211 上那份已经
   * 在跑时（比如要另起一套接本地 Worker 截效果图），给第二套指一个别的目录
   * 就能并存；只在本地设，Vercel 不配。见 .claude/launch.json 的 `*-alt`。
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",
  /**
   * 首屏那八份数据走 `use cache` + `cacheTag`，上报进来时按 tag 失效。
   *
   * 开了它之后 `dynamic` / `revalidate` / `fetchCache` **以及 `runtime`** 这几个
   * 段配置一律不能再导出，写了就是构建期报错 —— 官方迁移文档只写了前三个和
   * `runtime = "edge"`，但 `runtime = "nodejs"`（默认值）照样被拒。全站的渲染
   * 意图改由 `use cache` 和 `<Suspense>` 表达：取数缓存见 lib/home-snapshot，
   * 失效点见 lib/live-events 的 expireStatus（只刷本实例）；八条状态路由也读
   * lib/home-snapshot，但 STATUS_CACHE=false 的部署上它们改成每次直读 Redis，
   * 见 lib/api。首屏那份不受那个开关管 —— 冻着才有这里说的预渲染。
   */
  cacheComponents: true,
  async rewrites() {
    // 没配 R2 源就不挂这条：图片 404，页面其余部分照常
    if (!R2_ORIGIN) return [];
    return [{ source: IMAGE_REWRITE_SOURCE, destination: `${R2_ORIGIN}/:objectKey` }];
  },
  async headers() {
    return [
      {
        // 让 Vercel 遵循 R2 回来的 cache-control 缓存外部 rewrite 的响应。
        // 2026-04 之后新建的项目默认就开（这个项目是 8 月建的），显式写一次
        // 是不让图片缓存依赖面板里那个看不见的开关。
        source: `${IMAGE_PATH_PREFIX}/:path*`,
        headers: [{ key: "x-vercel-enable-rewrite-caching", value: "1" }],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
      {
        // 首页外层缓存策略。控制台缓存规则「首页遵循源站缓存」命中 `/` 后，边缘按
        // 这份头缓存：5 分钟内直接命中，之后 1 天内先回旧 HTML、后台回源取新 ——
        // 和 Vercel 那层的 stale-while-revalidate 同一个行为。这条规则删不得：
        // `/` 没有文件后缀，不被任何规则覆盖时 ESA 直接判 DYNAMIC、每次回源。
        // 首屏新鲜度不靠这一层：revalidateTag 照常失效 Vercel，浏览器挂载后经
        // SWR / WebSocket 直接向 Worker 取最新状态，旧壳最多展示几秒。
        // 注意别加 must-revalidate：它禁止返回过期缓存，和 SWR 的目标正好相反。
        source: "/",
        headers: [
          { key: "Cache-Control", value: "public, max-age=300, stale-while-revalidate=86400, stale-if-error=86400" },
        ],
      },
    ];
  },
  /**
   * 分享卡片那张图要的两份 ttf（见 app/opengraph-image）。
   *
   * 追踪本来就认得那两个字面量路径，但它记的是 pnpm 仓库里的真身
   * （`node_modules/.pnpm/geist@…/node_modules/geist/…`）—— 函数里没有
   * `node_modules/geist` 那条软链，代码按 `process.cwd()` 拼出来的路径就是
   * ENOENT。这里按**代码实际读的那个路径**再要一次，让字节以真文件落在那儿。
   *
   * 只挂 `/opengraph-image` 一条：那张图 `cacheLife("max")`，30 天后仍会在运行时
   * 重画一次，字体必须在函数里；首屏不读字体，别让它多背 300KB。
   */
  outputFileTracingIncludes: {
    "/opengraph-image": [
      "node_modules/geist/dist/fonts/geist-mono/GeistMono-Regular.ttf",
      "node_modules/geist/dist/fonts/geist-mono/GeistMono-Bold.ttf",
    ],
  },
  allowedDevOrigins: ["test.lyjw.dev", "127.0.0.1"],
  images: {
    /**
     * 只有「源图比展示格大、源站又缩不了」才放行优化器。
     *
     * 自建歌单封面：Apple blobstore 上的原图（实测 274KB PNG，没有 {w}x{h}），
     * 页面上那格只有 80px。host 用通配是因为散在 store-030 ~ store-037。
     *
     * GitHub 头像：**只作回退**。主路径是构建期把它缩到 128px webp、内联成
     * data URI 焊进首屏 HTML（见 lib/github-avatar-icon），页面顶部那张脸不该
     * 等第二趟网络请求。构建时拉不到源图才落到这条上，过优化器缩整图 JPEG。
     *
     * PlayStation 头像：psn-rsc 只有 _s(50) / _m(160) / _l(240) / _xl(440) 这一档
     * 路径后缀，提要里那格 40px、3× 要 120，够得着的最小一档是 160px 的 PNG（52KB），
     * 直连比过优化器（约 4KB）贵十倍 —— 它是 PSN 三个主机里唯一缩不到位的，所以
     * 只剩它还在这张名单上。Redis 仍只存上游 URL，不落 R2。
     *
     * 封面和奖杯图都不在此列：那两个主机自己认 `?w=&h=`（还会把热起来的尺寸
     * 转成 AVIF），改走源站现缩 + 直连，见 lib/playstation-image。
     *
     * 其余一律不走：R2 已经是压好的最终尺寸且 immutable，mzstatic 自带尺寸
     * 模板，再转一道是纯浪费。
     *
     * pathname 只能写 `/**`：`**` 匹配的是完整路径段，段内通配不成立。
     * search 省略等于放行任意查询串（预签名必须带 X-Amz-*，头像带 s=）。
     */
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
    /**
     * 仅供「自建部署 + 本机走 fake-IP 代理」这一种情况。
     *
     * Clash/Surge 那类代理在 TUN 模式下把域名解析到 198.18.0.0/15，而 Next 16
     * 的 SSRF 防护看到私有 IP 就拒绝取图（实测：hostname resolved to private
     * IP 198.18.8.12，连问 1.1.1.1 都是这个结果，是网络层劫持不是本机 DNS）。
     *
     * 默认关，Vercel 上不要设 —— 那边解析得到真实公网 IP，开了纯属白白削弱
     * SSRF 防护。真正干净的解法是在代理里给 blobstore.apple.com 配直连规则，
     * 这个开关只是不想让部署被代理配置卡住。
     */
    dangerouslyAllowLocalIP: process.env.IMAGE_ALLOW_LOCAL_IP === "true",
  },
};

/**
 * Sentry 的构建期部分：上报隧道、release 注入、source map 上传。
 *
 * tunnelRoute 写死一条固定路径而不是每次构建随机：lyjw131.com 的 ESA 会把首页 HTML
 * 和 JS 缓存到一天（stale-while-revalidate），旧 JS 还会往上一版的路径发。`/relay`
 * 没有文件后缀，ESA 不缓存，POST 原样回源 lyjw.me。
 *
 * source map 只在有 SENTRY_AUTH_TOKEN 时上传，上传完即删，不对外发布；没有令牌
 * （本地、没装 Sentry 的 Vercel 集成）时照常构建，只是 Sentry 里的调用栈是压缩后的。
 */
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
