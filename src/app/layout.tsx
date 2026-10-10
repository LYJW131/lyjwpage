import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";

import { PwaRegistration } from "@/components/pwa-registration";
import { RestReady } from "@/components/rest-ready";
import { SiteAnalytics } from "@/components/site-analytics";
import { ThemeProvider } from "@/components/theme-provider";
import { PsPlusSprite } from "@/components/trophies/ps-plus";
import { HEATMAP_STORAGE_KEY } from "@/lib/heatmap-preference";
import { liveSocketUrl } from "@/lib/live-socket";
import { earlyLiveSocketScript } from "@/lib/live-socket-boot";
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
    locale: "en_US",
    type: "website",
  },
  appleWebApp: { capable: true, title: site.shortName, statusBarStyle: "default" },
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
  const earlyLiveSocket = liveSocketUrl();

  return (
    <html
      lang="en"
      // next-themes 在水合前改写 class。
      suppressHydrationWarning
      className={`${GeistMono.variable} h-full`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("theme")||"system";document.documentElement.dataset.themeChoice=t;var h=localStorage.getItem(${JSON.stringify(HEATMAP_STORAGE_KEY)});document.documentElement.dataset.heatmap=h==="commit"?"commit":"tokens"}catch(e){}`,
          }}
        />
        {earlyLiveSocket ? (
          <script dangerouslySetInnerHTML={{ __html: earlyLiveSocketScript(earlyLiveSocket) }} />
        ) : null}
        <style
          dangerouslySetInnerHTML={{
            __html: `.theme-toggle-icon{display:none!important}html[data-theme-choice="light"] .theme-toggle-icon-light{display:block!important}html[data-theme-choice="dark"] .theme-toggle-icon-dark{display:block!important}html:not([data-theme-choice]) .theme-toggle-icon-system,html[data-theme-choice="system"] .theme-toggle-icon-system{display:block!important}.heatmap-panel{display:none!important}html:not([data-heatmap]) .heatmap-panel[data-heatmap-panel="tokens"],html[data-heatmap="tokens"] .heatmap-panel[data-heatmap-panel="tokens"],html[data-heatmap="commit"] .heatmap-panel[data-heatmap-panel="commit"]{display:block!important}html:not([data-heatmap]) .heatmap-tab[data-heatmap-tab="tokens"],html[data-heatmap="tokens"] .heatmap-tab[data-heatmap-tab="tokens"],html[data-heatmap="commit"] .heatmap-tab[data-heatmap-tab="commit"]{background-color:var(--muted)!important;color:var(--foreground)!important}`,
          }}
        />
      </head>
      <body className="flex min-h-full flex-col">
        <PsPlusSprite />
        {/* 普通图片使用 no-cors；带 crossOrigin 的预连接无法被它复用。 */}
        <link rel="preconnect" href="https://is1-ssl.mzstatic.com" />
        <ThemeProvider>{children}</ThemeProvider>
        <PwaRegistration />
        <RestReady />
        <SiteAnalytics />
      </body>
    </html>
  );
}
