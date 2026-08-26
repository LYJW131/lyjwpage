import { HeaderDesktop } from "@/components/live/live-desk-card";
import { HomeLink } from "@/components/home-link";
import { ThemeToggle } from "@/components/theme-toggle";
import type { DesktopPayload, StatusResponse } from "@/lib/types";

export function Header({ desktop }: { desktop: StatusResponse<DesktopPayload> }) {
  return (
    <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm">
      <div className="mx-auto w-[calc(100%-2rem)] max-w-5xl py-3 sm:py-4">
        <div className="grid min-h-10 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
          <HomeLink />
          <HeaderDesktop fallback={desktop} />
          <div className="justify-self-end">
            <ThemeToggle />
          </div>
        </div>
      </div>
    </header>
  );
}
