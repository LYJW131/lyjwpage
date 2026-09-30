import { OnlineCount } from "@/components/live/online-count";
import { buildTime, commit } from "@/lib/build-info";
import { cn } from "@/lib/utils";

// 构建替换只识别完整的 process.env.X，不能解构或动态取键。
const EXTRA_TEXT = process.env.FOOTER_EXTRA_TEXT?.trim() ?? "";
const EXTRA_HREF = process.env.FOOTER_EXTRA_HREF?.trim() ?? "";

export function Footer() {
  return (
    <footer className="mx-auto mb-6 w-[calc(100%-2rem)] max-w-5xl">
      <div
        className={cn(
          "label-mono flex flex-wrap items-center justify-center gap-x-2 gap-y-2 border-t border-line px-4 pt-4 text-muted-foreground [&>*+*]:before:mr-2 [&>*+*]:before:text-muted-foreground/50 [&>*+*]:before:content-['·']",
          "max-[32rem]:[&>*:last-child]:basis-full max-[32rem]:[&>*:last-child]:justify-center max-[32rem]:[&>*:last-child]:before:hidden",
          EXTRA_TEXT ? "pb-2" : "pb-4",
        )}
      >
        {commit && (
          <a
            href={commit.url}
            target="_blank"
            rel="noreferrer"
            className="-my-2 py-2 normal-case transition-colors hover:text-foreground"
          >
            {commit.short}
          </a>
        )}
        {buildTime && <span>Built {buildTime}</span>}
        <OnlineCount />
      </div>
      {EXTRA_TEXT ? (
        <div className="px-4 pb-4 text-center text-[11px] leading-relaxed text-muted-foreground">
          {EXTRA_HREF ? (
            <a
              href={EXTRA_HREF}
              target="_blank"
              rel="noreferrer"
              className="pt-1 pb-2 transition-colors hover:text-foreground"
            >
              {EXTRA_TEXT}
            </a>
          ) : (
            EXTRA_TEXT
          )}
        </div>
      ) : null}
    </footer>
  );
}
