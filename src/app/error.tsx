"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import Link from "next/link";

import { Footer } from "@/components/footer";
import { HomeLink } from "@/components/home-link";
import { ThemeToggle } from "@/components/theme-toggle";
import { Card } from "@/components/ui/card";
import { useStaleAutoReload } from "@/hooks/use-stale-auto-reload";
import { site } from "@/lib/site";

export default function Error({
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
  useStaleAutoReload("page-crash");

  return (
    <>
      <title>{`Something went wrong — ${site.name}`}</title>
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
          </Card>
        </div>
      </main>

      <Footer />
    </>
  );
}
