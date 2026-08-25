import Link from "next/link";

import { HeaderDesktop } from "@/components/live/live-desk-card";
import { ThemeToggle } from "@/components/theme-toggle";
import { site } from "@/lib/site";
import type { DesktopPayload, StatusResponse } from "@/lib/types";

export function Header({ desktop }: { desktop: StatusResponse<DesktopPayload> }) {
  return (
    <header id="top" className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm">
      <div className="mx-auto w-[calc(100%-2rem)] max-w-5xl py-3 sm:py-4">
        <div className="grid min-h-10 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
          <Link
            href="/"
            className="min-w-0 justify-self-start truncate text-sm font-bold tracking-tight"
          >
            <span className="sm:hidden">{site.shortName}</span>
            <span className="hidden sm:inline">{site.name}</span>
          </Link>
          <HeaderDesktop fallback={desktop} />
          <div className="justify-self-end">
            <ThemeToggle />
          </div>
        </div>
      </div>
    </header>
  );
}
