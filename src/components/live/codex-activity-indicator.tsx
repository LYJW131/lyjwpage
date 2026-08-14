import Image from "next/image";

import { cn } from "@/lib/utils";

const CODEX_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Codex CLI 终端标题使用的官方 Braille spinner，每 100ms 切换一帧。
 * 不活跃时退回静态状态点，避免闲置状态仍然看起来像在工作。
 */
export function CodexActivityIndicator({
  active,
  className,
}: {
  active: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "relative grid size-5 shrink-0 place-items-center font-mono text-base leading-none",
        active && "text-live",
        className,
      )}
      aria-hidden
    >
      {active ? (
        CODEX_SPINNER_FRAMES.map((frame, index) => (
          <span
            key={frame}
            className="codex-spinner-frame absolute inset-0 grid place-items-center"
            style={{ animationDelay: `${index === 0 ? 0 : index * 100 - 1_000}ms` }}
          >
            {frame}
          </span>
        ))
      ) : (
        <>
          {/*
            深浅两版只差圆角底的颜色，靠 CSS 换 —— 底色要跟着主题翻，
            浅色页面上用深色底、深色页面上用白底，图标才始终有对比。
            两张都是矢量，加起来还不到从前一张位图大。
          */}
          <Image
            src="/codex-icon-light.svg"
            width={20}
            height={20}
            alt=""
            unoptimized
            className="size-5 dark:hidden"
          />
          <Image
            src="/codex-icon-dark.svg"
            width={20}
            height={20}
            alt=""
            unoptimized
            className="hidden size-5 dark:block"
          />
        </>
      )}
    </span>
  );
}
