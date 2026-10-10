import { CardBoundary } from "@/components/card-boundary";
import { HeaderDesktop } from "@/components/live/live-desk-card";
import { HomeLink } from "@/components/home-link";
import { ThemeToggle } from "@/components/theme-toggle";
import { MiniPlayer } from "@/components/web-player/mini-player";
import { DESKTOP_PATH } from "@/lib/paths";
import type { DesktopPayload, StatusResponse } from "@/lib/types";

export function Header({
  desktop,
  desktopIconDataUri,
}: {
  desktop: StatusResponse<DesktopPayload>;
  desktopIconDataUri: string | null;
}) {
  return (
    <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm">
      <div className="mx-auto w-[calc(100%-2rem)] max-w-5xl py-3 sm:py-4">
        {/* 徽章脱离文档流，避免应用名宽度变化推动两侧并产生 CLS。 */}
        <div className="relative grid min-h-10 grid-cols-2 items-center gap-3">
          <HomeLink heading />
          <div className="flex items-center gap-2 justify-self-end">
            <MiniPlayer />
            <ThemeToggle />
          </div>
          <CardBoundary label="Header Desktop" silent paths={[DESKTOP_PATH]}>
            <HeaderDesktop
              fallback={desktop}
              iconDataUri={desktopIconDataUri}
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            />
          </CardBoundary>
        </div>
      </div>
    </header>
  );
}
