import type { Metadata, Viewport } from "next";
// 用本地字体包而不是 next/font/google：构建时不依赖网络
import { GeistMono } from "geist/font/mono";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

import { ThemeProvider } from "@/components/theme-provider";
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
            __html: `try{var t=localStorage.getItem("theme")||"system";document.documentElement.dataset.themeChoice=t}catch(e){}`,
          }}
        />
      </head>
      <body className="flex min-h-full flex-col">
        {/* 封面图（LCP）和剧照的域名，由 React 提升进 head。
            不能加 crossOrigin：这两处都是普通 <img> 的 no-cors 请求，
            带 crossorigin 的连接它们复用不上，等于白连一次 */}
        <link rel="preconnect" href="https://is1-ssl.mzstatic.com" />
        <link rel="preconnect" href="https://r2.homepage.lyjw.llc" />
        <ThemeProvider>{children}</ThemeProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
