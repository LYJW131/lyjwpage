import { commitSha } from "@/lib/build-info";
import type { AppVersionPayload } from "@/lib/app-version";

/**
 * 这次部署自己是哪一版。
 *
 * 更新提示问的是「现在刷新会拿到哪一版」，最准的回答者就是此刻接管生产域名的那次
 * 部署本身：构建中的部署还没接管域名，不会提前提示；回滚时域名指回旧部署，答的就是
 * 旧 sha。不经过 Worker、KV，也不用 Vercel API 令牌，没有同步延迟。
 *
 * 不读请求、不联网，构建时就预渲染成静态响应（Cache Components 下的 GET Route
 * Handler 默认如此），随部署分发，不算函数调用。值全是构建期常量。
 *
 * ⚠️ 开了 Vercel Skew Protection 的话，旧页面发出的请求会被钉在旧部署上，永远答
 * 旧 sha——到时要给这条请求显式绕开。Hobby 没有这个功能。
 */
export function GET() {
  const payload: AppVersionPayload = {
    commit: commitSha,
    // 只要标题那一行，和 Commit 栏同一口径（lib/vercel-deployments）；正文进卡片会接在标题后面
    message: process.env.VERCEL_GIT_COMMIT_MESSAGE?.split("\n")[0].trim().slice(0, 180) || null,
    builtAt: process.env.BUILD_TIME || null,
  };
  return Response.json(payload);
}
