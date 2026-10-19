import { FadeInImage } from "@/components/fade-in-image";
import { Chart } from "@/components/chat-visual/chart";
import { Diagram } from "@/components/chat-visual/diagram";
import { Heading, Ink, Streaming } from "@/components/chat-visual/ink";
import { appleArtwork, ARTWORK_SCALE, needsOptimizing } from "@/lib/apple-artwork";
import { cn } from "@/lib/utils";
import type { ChatVisual, GodChatVisualKind, MediaShape, MediaVisual, StatsVisual, TimelineVisual } from "@shared/god-chat";

const PLACEHOLDER_HEIGHT: Record<GodChatVisualKind, number> = { stats: 72, chart: 220, timeline: 120, media: 120, diagram: 200 };

export function VisualPlaceholder({ kind }: { kind: GodChatVisualKind }) {
  return <div className="my-3 animate-pulse bg-surface" style={{ height: PLACEHOLDER_HEIGHT[kind] }} />;
}
export function ChatVisualView({ visual, streaming = false }: { visual: ChatVisual; streaming?: boolean }) {
  return (
    <Streaming.Provider value={streaming}>
      <div className="my-3">{visualBody(visual)}</div>
    </Streaming.Provider>
  );
}

function visualBody(visual: ChatVisual) {
  switch (visual.kind) {
    case "stats":
      return <Stats visual={visual} />;
    case "chart":
      return <Chart visual={visual} />;
    case "timeline":
      return <Timeline visual={visual} />;
    case "media":
      return <Media visual={visual} />;
    case "diagram":
      return <Diagram visual={visual} />;
  }
}
function Stats({ visual }: { visual: StatsVisual }) {
  const { summary } = visual;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-x-4 gap-y-3">
        {visual.items.map((item, i) => (
          <div key={i} className="min-w-0">
            <div className="text-xs text-muted-foreground"><Ink>{item.label}</Ink></div>
            <div className="text-xl leading-tight font-semibold"><Ink>{item.value}</Ink></div>
            {item.note && <div className="text-xs text-muted-foreground"><Ink>{item.note}</Ink></div>}
          </div>
        ))}
      </div>
      {summary && (
        <div className="border border-line px-3 py-2">
          <div className="text-xs text-muted-foreground"><Ink>{summary.label}</Ink></div>
          <div
            className={cn(
              "text-lg leading-tight font-semibold",
              summary.tone === "good" && "text-signal-green",
              summary.tone === "bad" && "text-signal-red",
            )}
          >
            <Ink>{summary.value}</Ink>
          </div>
          {summary.note && <div className="text-xs text-muted-foreground"><Ink>{summary.note}</Ink></div>}
        </div>
      )}
    </div>
  );
}
function Timeline({ visual }: { visual: TimelineVisual }) {
  return (
    <div>
      <Heading title={visual.title} />
      <div className="border-l border-line">
        {visual.items.map((item, i) => (
          <div key={i} className="relative pb-3 pl-4 last:pb-0">
            <span aria-hidden className="absolute top-[0.4rem] -left-[3.5px] size-1.5 bg-foreground" />
            <div className="font-mono text-2xs text-muted-foreground"><Ink>{item.time}</Ink></div>
            <div className="font-medium"><Ink>{item.title}</Ink></div>
            {item.text && <div className="text-muted-foreground"><Ink>{item.text}</Ink></div>}
          </div>
        ))}
      </div>
    </div>
  );
}

const THUMB: Record<MediaShape, { className: string; px: number }> = {
  square: { className: "aspect-square w-12", px: 48 },
  poster: { className: "aspect-[2/3] w-10", px: 40 },
  wide: { className: "aspect-video w-20", px: 80 },
};

function Thumb({ src, shape }: { src?: string; shape: MediaShape }) {
  const { className, px } = THUMB[shape];
  const sized = src?.includes("{w}") ? appleArtwork(src, px * ARTWORK_SCALE) : src;
  return (
    <div className={cn("relative shrink-0 overflow-hidden border border-line bg-muted", className)}>
      {sized && <FadeInImage src={sized} alt="" fill sizes={`${px}px`} className="object-cover" unoptimized={!needsOptimizing(sized)} />}
    </div>
  );
}

function Media({ visual }: { visual: MediaVisual }) {
  const showThumbs = visual.items.some((item) => item.image);
  return (
    <div>
      <Heading title={visual.title} />
      <div className="space-y-1">
        {visual.items.map((item, i) => {
          const body = (
            <>
              {showThumbs && <Thumb src={item.image} shape={visual.shape} />}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium"><Ink>{item.title}</Ink></div>
                {item.subtitle && <div className="truncate text-xs text-muted-foreground"><Ink>{item.subtitle}</Ink></div>}
              </div>
              {item.meta && <div className="shrink-0 text-xs text-muted-foreground tabular-nums">{item.meta}</div>}
            </>
          );
          const row = "flex items-center gap-3 py-1";
          return item.url ? (
            <a key={i} href={item.url} target="_blank" rel="noreferrer noopener" className={cn(row, "-mx-1.5 px-1.5 transition-colors hover:bg-surface-hover")}>
              {body}
            </a>
          ) : (
            <div key={i} className={row}>
              {body}
            </div>
          );
        })}
      </div>
    </div>
  );
}
