import { HeaderTimezone } from "@/components/header-timezone";
import { ThemeToggle } from "@/components/theme-toggle";
import { StatusDot } from "@/components/ui/status-dot";
import { site } from "@/lib/site";
import type { StatusResponse, TimezonePayload } from "@/lib/types";

export function Header({
  timezone,
}: {
  timezone: StatusResponse<TimezonePayload>;
}) {
  return (
    <header id="top" className="relative z-50">
      <div className="mx-auto w-[calc(100%-2rem)] max-w-5xl pt-4 sm:pt-6">
        <div className="flex min-h-10 items-center gap-3">
          <a href="#top" className="shrink-0 text-sm font-bold tracking-tight">
            {site.name}
          </a>
          <nav
            className="flex min-w-0 flex-1 items-center gap-1"
            aria-label="页面区块"
          >
            <a href="#live" className="nav-cell flex-1">
              <StatusDot tone="live" />
              <span>Live</span>
            </a>
            <a href="#vibe-coding" className="nav-cell flex-1">
              Vibe Coding
            </a>
            <a href="#watching" className="nav-cell flex-1">
              Media
            </a>
          </nav>
          <HeaderTimezone fallback={timezone} />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
