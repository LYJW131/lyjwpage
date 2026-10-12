import { useEffect, useRef, useState, type ReactNode } from "react";

import { HTML_PREVIEW_HEIGHT_KEY, HTML_PREVIEW_MIN_HEIGHT, htmlPreviewDocument, previewHeight } from "@/lib/html-preview";
import { cn } from "@/lib/utils";

const TAB_CLASS = "rounded px-1.5 py-0.5 transition-colors hover:text-foreground aria-pressed:bg-background aria-pressed:text-foreground";

export function ChatHtmlPreview({ source, code }: { source: string; code: ReactNode }) {
  const [view, setView] = useState<"preview" | "code">("preview");
  const [height, setHeight] = useState(HTML_PREVIEW_MIN_HEIGHT);
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) return;
      const next = previewHeight((event.data as Record<string, unknown> | null)?.[HTML_PREVIEW_HEIGHT_KEY]);
      if (next !== null) setHeight(next);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div className="my-2 overflow-hidden rounded-md border border-line">
      <div className="flex items-center justify-between border-b border-line bg-surface px-2 py-1 text-[11px] text-muted-foreground">
        <span className="font-mono">html</span>
        <div className="flex gap-0.5">
          <button type="button" aria-pressed={view === "preview"} onClick={() => setView("preview")} className={TAB_CLASS}>
            Preview
          </button>
          <button type="button" aria-pressed={view === "code"} onClick={() => setView("code")} className={TAB_CLASS}>
            Code
          </button>
        </div>
      </div>
      <iframe
        ref={frameRef}
        title="HTML preview"
        sandbox="allow-scripts"
        srcDoc={htmlPreviewDocument(source)}
        className={cn("block w-full bg-white", view !== "preview" && "hidden")}
        style={{ height }}
      />
      {view === "code" && code}
    </div>
  );
}
