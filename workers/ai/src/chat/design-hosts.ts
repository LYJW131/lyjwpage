// 须与 Managed Agents 环境的 allowed_hosts 一致（designer:setup 写入）：web 工具列了环境没放行的主机，建会话直接 400，所以先更新环境再发布 Worker。
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
