import Image from "next/image";

import { cn } from "@/lib/utils";

const CODEX_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** 闲置时用的 Codex 标，深浅两版只差圆角底。 */
export function CodexMark({ className }: { className?: string }) {
  return (
    <>
      <Image
        src="/codex-icon-light.svg"
        width={20}
        height={20}
        alt=""
        unoptimized
        className={cn("size-5 dark:hidden", className)}
      />
      <Image
        src="/codex-icon-dark.svg"
        width={20}
        height={20}
        alt=""
        unoptimized
        className={cn("hidden size-5 dark:block", className)}
      />
    </>
  );
}

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
        <CodexMark />
      )}
    </span>
  );
}
