import type { Metadata, Viewport } from "next";
// 用本地字体包而不是 next/font/google：构建时不依赖网络
import { GeistMono } from "geist/font/mono";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

import { ThemeProvider } from "@/components/theme-provider";
import { HEATMAP_STORAGE_KEY } from "@/lib/heatmap-preference";
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
  const assetBaseUrl = process.env.R2_PUBLIC_BASE_URL ?? "";
  let assetOrigin: string | null = null;
  try {
    assetOrigin = assetBaseUrl ? new URL(assetBaseUrl).origin : null;
  } catch {
    // 配坏时不预连接；状态响应里的图片地址也会按原有降级逻辑为空。
  }

  return (
    <html
      lang="zh-CN"
      // next-themes 会往这里塞 class，交给它管，避免 hydration 报错
      suppressHydrationWarning
      className={`${GeistMono.variable} h-full`}
    >
      <head>
        <meta name="asset-base-url" content={assetBaseUrl} />
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("theme")||"system";document.documentElement.dataset.themeChoice=t;var h=localStorage.getItem(${JSON.stringify(HEATMAP_STORAGE_KEY)});document.documentElement.dataset.heatmap=h==="commit"?"commit":"tokens"}catch(e){}`,
          }}
        />
        <style
          dangerouslySetInnerHTML={{
            __html: `.theme-toggle-icon{display:none!important}html[data-theme-choice="light"] .theme-toggle-icon-light{display:block!important}html[data-theme-choice="dark"] .theme-toggle-icon-dark{display:block!important}html:not([data-theme-choice]) .theme-toggle-icon-system,html[data-theme-choice="system"] .theme-toggle-icon-system{display:block!important}.heatmap-panel{display:none!important}html:not([data-heatmap]) .heatmap-panel[data-heatmap-panel="tokens"],html[data-heatmap="tokens"] .heatmap-panel[data-heatmap-panel="tokens"],html[data-heatmap="commit"] .heatmap-panel[data-heatmap-panel="commit"]{display:block!important}html:not([data-heatmap]) .heatmap-tab[data-heatmap-tab="tokens"],html[data-heatmap="tokens"] .heatmap-tab[data-heatmap-tab="tokens"],html[data-heatmap="commit"] .heatmap-tab[data-heatmap-tab="commit"]{background-color:var(--muted)!important;color:var(--foreground)!important}`,
          }}
        />
      </head>
      <body className="flex min-h-full flex-col">
        {/* 封面图（LCP）和剧照的域名，由 React 提升进 head。
            不能加 crossOrigin：这两处都是普通 <img> 的 no-cors 请求，
            带 crossorigin 的连接它们复用不上，等于白连一次 */}
        <link rel="preconnect" href="https://is1-ssl.mzstatic.com" />
        {assetOrigin ? <link rel="preconnect" href={assetOrigin} /> : null}
        <ThemeProvider>{children}</ThemeProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
