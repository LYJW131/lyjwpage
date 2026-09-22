import { HeaderDesktop } from "@/components/live/live-desk-card";
import { HomeLink } from "@/components/home-link";
import { ThemeToggle } from "@/components/theme-toggle";
import { MiniPlayer } from "@/components/web-player/mini-player";
import type { DesktopPayload, StatusResponse } from "@/lib/types";

export function Header({
  desktop,
  desktopIconDataUri,
}: {
  desktop: StatusResponse<DesktopPayload>;
  /** 首屏那枚图标的内联副本，见 lib/desktop-icon-inline；压不出来是 null */
  desktopIconDataUri: string | null;
}) {
  return (
    <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm">
      <div className="mx-auto w-[calc(100%-2rem)] max-w-5xl py-3 sm:py-4">
        {/*
          中间那枚「正在使用」的徽章脱离文档流。

          它从前占着 grid 的 auto 列，宽度由里面那行隐藏的量宽元素决定 —— 应用
          一换（文字名换成字标、或者换个名字更长的应用），这一列跟着变宽，两边
          1fr 的列一起挪，桌面端就记一笔 CLS。绝对居中之后它多宽都不动别人；
          自身的 max-w 已经给两侧留了 9rem，压不到左右两组。
        */}
        <div className="relative grid min-h-10 grid-cols-2 items-center gap-3">
          <HomeLink />
          <div className="flex items-center gap-2 justify-self-end">
            <MiniPlayer />
            <ThemeToggle />
          </div>
          <HeaderDesktop
            fallback={desktop}
            iconDataUri={desktopIconDataUri}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          />
        </div>
      </div>
    </header>
  );
}
