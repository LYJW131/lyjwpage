import type { NowListeningNext } from "@shared/types";
import { cn } from "@/lib/utils";

const NEXT_BASIS = {
  loop: { label: "Loop", hint: "Guessed from the last few songs repeating in the same order" },
  order: { label: "In Order", hint: "Guessed from where it is in the playlist or album" },
} as const;

export function NextBadge({ basis, className }: { basis: NowListeningNext["basis"]; className?: string }) {
  return (
    <span
      className={cn("inline-flex shrink-0 items-center rounded-sm border border-dashed border-line px-1.5 py-px text-2xs leading-4 text-muted-foreground", className)}
      title={NEXT_BASIS[basis].hint}
    >
      {NEXT_BASIS[basis].label}
    </span>
  );
}

export function UpNext({ next, inline = false }: { next: NowListeningNext; inline?: boolean }) {
  if (inline) {
    return (
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <span className="label-mono shrink-0 text-muted-foreground">Up Next</span>
        <span className="min-w-0 flex-1 truncate" title={next.artist ? `${next.title} · ${next.artist}` : next.title}>
          <span className="font-medium">{next.title}</span>
          {next.artist && <span className="text-muted-foreground"> · {next.artist}</span>}
        </span>
        <NextBadge basis={next.basis} />
      </div>
    );
  }
  return (
    <div className="flex h-20 min-w-0 flex-col justify-center">
      <div className="flex min-h-5 items-center gap-1.5">
        <span className="label-mono text-muted-foreground">Up Next</span>
        <NextBadge basis={next.basis} />
      </div>
      <div className="mt-1 truncate font-medium leading-snug" title={next.title}>
        {next.title}
      </div>
      {next.artist && (
        <div className="mt-px truncate text-sm text-muted-foreground" title={next.artist}>
          {next.artist}
        </div>
      )}
    </div>
  );
}
