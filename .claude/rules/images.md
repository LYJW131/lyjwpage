---
paths:
  - "src/components/app-image.tsx"
  - "src/lib/image-proxy.ts"
  - "src/lib/*-inline.ts"
  - "src/lib/dedupe-inline-images.ts"
  - "shared/asset-url.ts"
  - "scripts/site-assets/**"
  - "src/lib/site-policy.ts"
---

# 图片交付

- 静态图标使用 `src/components/app-image.tsx`（`AppImage`）时都设 `unoptimized`，直接加载最终资源。图片优化器仅用于远端原图比展示尺寸大、且源站无法提供合适尺寸的情况，允许列表见 `src/lib/image-proxy.ts`。直连的第三方图（`unoptimized`）在访客网络里加载失败时，`AppImage` 改走一次同一代理；代理也失败就藏起这张图，露出容器底色，不显示 alt 文字。
- 不在每个请求中重复压图。允许按不可变内容地址压缩一次并缓存：`src/lib/desktop-icon-inline.ts` 按 `objectKey` 压缩 R2 原件、内联首屏；充电头封面图标由 `src/lib/charger-icon-inline.ts` 同法写进首屏 loader 数据（loader 数据里重复的那份由 `src/lib/dedupe-inline-images.ts` 读回 `<img>`）；首页 GitHub 头像由 `src/lib/github-avatar-inline.ts` 在渲染时经图片变体内联为 data URI，随首页缓存复用；构建期只用它生成图标与 OG 图（`scripts/site-assets/avatar.ts`）。
- R2 图片在页面、状态 API 和推送里都是 `/img/<objectKey>` 同源路径（`shared/asset-url.ts`），不烧交付域（字面量由 `pnpm rules:check` 拦），图片字节不进站点渲染层：`/img/*` 由 site Worker 的 R2 绑定直出，`lyjw131.com` 由 ESA 缓存并回源（规则见 `docs/ops-facts.md`）。改前缀要同步改站点路由和 ESA 规则。
