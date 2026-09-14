import type { Metadata, Viewport } from "next";
// 用本地字体包而不是 next/font/google：构建时不依赖网络
import { GeistMono } from "geist/font/mono";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

import { PwaRegistration } from "@/components/pwa-registration";
import { ThemeProvider } from "@/components/theme-provider";
import { HEATMAP_STORAGE_KEY } from "@/lib/heatmap-preference";
import { onlineSocketUrl } from "@/lib/live-socket";
import { earlyOnlineSocketScript } from "@/lib/online-socket-boot";
import { site } from "@/lib/site";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: site.name,
    template: `%s — ${site.name}`,
  },
  description: site.description,
  openGraph: {
    title: site.name,
    description: site.description,
    url: site.url,
    siteName: site.name,
    // 页面是中文的，OG 不跟着 <html lang> 走，得自己报一次
    locale: "zh_CN",
    type: "website",
  },
  appleWebApp: { capable: true, title: site.shortName, statusBarStyle: "default" },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  // 没配在线人数 Worker 时 workerUrl 返回 null，那段内联脚本整个不渲染
  const earlyOnlineSocket = onlineSocketUrl();

  return (
    <html
      lang="zh-CN"
      // next-themes 会往这里塞 class，交给它管，避免 hydration 报错
      suppressHydrationWarning
      className={`${GeistMono.variable} h-full`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("theme")||"system";document.documentElement.dataset.themeChoice=t;var h=localStorage.getItem(${JSON.stringify(HEATMAP_STORAGE_KEY)});document.documentElement.dataset.heatmap=h==="commit"?"commit":"tokens"}catch(e){}`,
          }}
        />
        {/*
          「此刻在线」那条 WebSocket 在这儿就起手，不等 hydration —— 整整早 850ms，
          理由和交接方式见 lib/online-socket-boot 与 hooks/use-online-count。
        */}
        {earlyOnlineSocket ? (
          <script dangerouslySetInnerHTML={{ __html: earlyOnlineSocketScript(earlyOnlineSocket) }} />
        ) : null}
        <style
          dangerouslySetInnerHTML={{
            __html: `.theme-toggle-icon{display:none!important}html[data-theme-choice="light"] .theme-toggle-icon-light{display:block!important}html[data-theme-choice="dark"] .theme-toggle-icon-dark{display:block!important}html:not([data-theme-choice]) .theme-toggle-icon-system,html[data-theme-choice="system"] .theme-toggle-icon-system{display:block!important}.heatmap-panel{display:none!important}html:not([data-heatmap]) .heatmap-panel[data-heatmap-panel="tokens"],html[data-heatmap="tokens"] .heatmap-panel[data-heatmap-panel="tokens"],html[data-heatmap="commit"] .heatmap-panel[data-heatmap-panel="commit"]{display:block!important}html:not([data-heatmap]) .heatmap-tab[data-heatmap-tab="tokens"],html[data-heatmap="tokens"] .heatmap-tab[data-heatmap-tab="tokens"],html[data-heatmap="commit"] .heatmap-tab[data-heatmap-tab="commit"]{background-color:var(--muted)!important;color:var(--foreground)!important}`,
          }}
        />
      </head>
      <body className="flex min-h-full flex-col">
        {/* 封面图（LCP）的域名，由 React 提升进 head。
            不能加 crossOrigin：那是普通 <img> 的 no-cors 请求，
            带 crossorigin 的连接它复用不上，等于白连一次。
            海报和图标不用预连：它们走同源 `/img/`，复用页面这条连接 */}
        <link rel="preconnect" href="https://is1-ssl.mzstatic.com" />
        <ThemeProvider>{children}</ThemeProvider>
        <PwaRegistration />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
