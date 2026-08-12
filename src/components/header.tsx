import { HeaderTimezone } from "@/components/header-timezone";
import { HeaderDesktop } from "@/components/live/live-desk-card";
import { ThemeToggle } from "@/components/theme-toggle";
import { site } from "@/lib/site";
import type { DesktopPayload, StatusResponse, TimezonePayload } from "@/lib/types";

export function Header({
  desktop,
  timezone,
}: {
  desktop: StatusResponse<DesktopPayload>;
  timezone: StatusResponse<TimezonePayload>;
}) {
  return (
    <header id="top" className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm">
      <div className="mx-auto w-[calc(100%-2rem)] max-w-5xl py-3 sm:py-4">
        <div className="flex min-h-10 items-center gap-3">
          <a href="#top" className="shrink-0 text-sm font-bold tracking-tight">
            {site.name}
          </a>
          <HeaderDesktop fallback={desktop} className="flex-1" />
          <HeaderTimezone fallback={timezone} />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
