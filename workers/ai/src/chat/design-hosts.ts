// 设计会话沙盒能联网的主机，scripts/setup-designer.ts 把它写进 environment 的 allowed_hosts，web 工具的 allowed_domains 也用它。
// 工具里列了环境没放行的主机，创建会话直接 400：加主机先跑 designer:setup 更新环境，再发布 Worker。
export const DESIGN_WEB_HOSTS = [
  "github.com",
  "developers.cloudflare.com",
  "reactrouter.com",
  "react.dev",
  "developer.mozilla.org",
  "tailwindcss.com",
  "swr.vercel.app",
  "motion.dev",
  "platform.claude.com",
  "developer.apple.com",
] as const;
