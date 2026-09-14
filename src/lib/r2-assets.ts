/**
 * 站点服务端直取 R2 原件的地址。
 *
 * 只有一个用户：首屏图标内联（desktop-icon-inline）要在 Vercel 的函数里把原图
 * 抓回来压。它不该走页面上那条 `/img/` —— 那是访客域名的边缘在代理，函数自己
 * 绕回自己的边缘再出去，等于多一跳白跑。
 *
 * `R2_PUBLIC_BASE_URL` 因此是站点独有的配置：next.config 用它当 rewrite 的目的地，
 * 这里用它做服务端抓图。Worker 不再需要它，页面和状态 API 里的图片地址见
 * `@/lib/asset-url`。
 */
export function r2OriginUrl(objectKey: string): string | null {
  const base = process.env.R2_PUBLIC_BASE_URL;
  return base ? `${base.replace(/\/+$/, "")}/${objectKey}` : null;
}
