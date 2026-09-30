import Image from "@/components/app-image";
import { cn } from "@/lib/utils";

const CODEX_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

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
