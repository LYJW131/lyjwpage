"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import Link from "next/link";

import { globalErrorThemeScript, THEME_COLOR_DARK, THEME_COLOR_LIGHT } from "@/lib/theme-chrome";

import "./globals.css";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <title>System error</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content={THEME_COLOR_LIGHT} media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content={THEME_COLOR_DARK} media="(prefers-color-scheme: dark)" />
        <script dangerouslySetInnerHTML={{ __html: globalErrorThemeScript() }} />
      </head>
      <body className="flex min-h-full flex-col items-center justify-center bg-background px-4 text-foreground">
        <div className="paper-card w-full max-w-md rounded-lg border border-line-strong bg-surface p-6 text-center sm:p-8">
          <div className="label-mono text-xs text-muted-foreground">500 / SYSTEM ERROR</div>
          <h1 className="mt-2 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Service temporarily unavailable
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            The underlying system hit an error. Refresh or try again later.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => reset()}
              className="paper-card inline-flex h-8 items-center justify-center rounded-md border border-line-strong bg-surface px-4 text-xs font-medium text-foreground transition-colors hover:bg-surface-hover"
            >
              Retry
            </button>
            <Link
              href="/"
              className="paper-card inline-flex h-8 items-center justify-center rounded-md border border-line-strong bg-surface px-4 text-xs font-medium text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              Back to home
            </Link>
          </div>
        </div>
      </body>
    </html>
  );
}
