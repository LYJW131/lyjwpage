import { useEffect, useLayoutEffect } from "react";
import * as Sentry from "@sentry/react";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  ScrollRestoration,
  Scripts,
  useLocation,
  useRouteError,
  type LinkDescriptor,
  type MetaArgs,
  type MetaDescriptor,
} from "react-router";

import { Footer } from "@/components/footer";
import { HomeLink } from "@/components/home-link";
import NotFound from "@/app/not-found";
import { PwaRegistration } from "@/components/pwa-registration";
import { RestReady } from "@/components/rest-ready";
import { SiteAnalytics } from "@/components/site-analytics";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { PsPlusSprite } from "@/components/trophies/ps-plus";
import { Card } from "@/components/ui/card";
import { useStaleAutoReload } from "@/hooks/use-stale-auto-reload";
import { DOCUMENT_COMMIT_META } from "@/lib/app-version";
import { commitSha } from "@/lib/build-info";
import { HEATMAP_STORAGE_KEY, syncHeatmapToDocument } from "@/lib/heatmap-preference";
import { liveSocketUrl } from "@/lib/live-socket";
import { earlyLiveSocketScript } from "@/lib/live-socket-boot";
import { site } from "@shared/site";
import { readSystemDark, readThemeChoice, syncThemeToDocument, themeBootScript } from "@/lib/theme";

import "./globals.css";

function bootScript(): string {
  return (
    themeBootScript() +
    `try{var h=localStorage.getItem(${JSON.stringify(HEATMAP_STORAGE_KEY)});document.documentElement.dataset.heatmap=h==="commit"?"commit":"tokens"}catch(e){}`
  );
}

function errorTitle(error: unknown): string {
  if (!error) return site.name;
  if (isRouteErrorResponse(error) && error.status === 404) return `404 — ${site.name}`;
  return `Something went wrong — ${site.name}`;
}

export function meta({ error }: MetaArgs): MetaDescriptor[] {
  return [
    { title: errorTitle(error) },
    { name: "description", content: site.description },
    { property: "og:title", content: site.name },
    { property: "og:description", content: site.description },
    { property: "og:url", content: site.url },
    { property: "og:site_name", content: site.name },
    { property: "og:locale", content: "en_US" },
    { property: "og:type", content: "website" },
    { property: "og:image", content: `${site.url}/opengraph-image` },
    { name: "apple-mobile-web-app-capable", content: "yes" },
    { name: "apple-mobile-web-app-title", content: site.shortName },
    { name: "apple-mobile-web-app-status-bar-style", content: "default" },
    { name: "robots", content: "index, follow" },
  ];
}

export function links(): LinkDescriptor[] {
  return [
    { rel: "canonical", href: site.url },
    { rel: "manifest", href: "/manifest.webmanifest" },
    { rel: "icon", href: "/icon", type: "image/png", sizes: "32x32" },
    { rel: "apple-touch-icon", href: "/apple-icon" },
    // 普通图片使用 no-cors；带 crossOrigin 的预连接无法被它复用。
    { rel: "preconnect", href: "https://is1-ssl.mzstatic.com" },
  ];
}

// 水合不一致时 React 退回整页客户端渲染，会清空 <html> 上全部属性（react-dom 的 commitHostSingletonAcquisition），
// 启动脚本写的主题和热力图选择随之丢失；在同一次提交、绘制之前按存储补回。
function BootAttributes() {
  useLayoutEffect(() => {
    syncThemeToDocument(readThemeChoice(), readSystemDark());
    syncHeatmapToDocument();
  }, []);
  return null;
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const earlyLiveSocket = pathname === "/" ? liveSocketUrl() : null;

  return (
    <html lang="en" suppressHydrationWarning className="h-full">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {commitSha ? <meta name={DOCUMENT_COMMIT_META} content={commitSha} /> : null}
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0a0a0a" />
        <Meta />
        <Links />
        <script dangerouslySetInnerHTML={{ __html: bootScript() }} />
        {earlyLiveSocket ? (
          <script dangerouslySetInnerHTML={{ __html: earlyLiveSocketScript(earlyLiveSocket) }} />
        ) : null}
      </head>
      <body className="flex min-h-full flex-col">
        <BootAttributes />
        <PsPlusSprite />
        <ThemeProvider>{children}</ThemeProvider>
        <PwaRegistration />
        <RestReady />
        <SiteAnalytics />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

function PageError({ error }: { error: unknown }) {
  useEffect(() => {
    console.error(error);
    Sentry.captureException(error);
  }, [error]);
  useStaleAutoReload("page-crash");

  return (
    <>
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm">
        <div className="mx-auto w-[calc(100%-2rem)] max-w-5xl py-3 sm:py-4">
          <div className="flex min-h-10 items-center justify-between gap-3">
            <HomeLink />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center py-12">
        <div className="mx-auto w-[calc(100%-2rem)] max-w-md">
          <Card label="ERROR" tone="off">
            <div className="flex flex-col items-center p-6 text-center sm:p-8">
              <div className="label-mono text-3xl font-bold tracking-widest text-foreground sm:text-4xl">
                Something went wrong
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                An unexpected error occurred while rendering this page. Try reloading.
              </p>
              <div className="mt-6 flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="paper-card inline-flex h-8 items-center justify-center rounded-md border border-line-strong bg-surface px-4 text-xs font-medium text-foreground transition-colors hover:bg-surface-hover"
                >
                  Retry
                </button>
                <a
                  href="/"
                  className="paper-card inline-flex h-8 items-center justify-center rounded-md border border-line-strong bg-surface px-4 text-xs font-medium text-foreground transition-colors hover:bg-surface-hover"
                >
                  Back to home
                </a>
              </div>
            </div>
          </Card>
        </div>
      </main>

      <Footer />
    </>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFound />;
  return <PageError error={error} />;
}
