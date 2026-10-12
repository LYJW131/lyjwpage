import { Check, Code, Copy, LoaderCircle, Maximize, Play, RotateCcw } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { htmlPreviewDocument } from "@/lib/html-preview";
import { cn } from "@/lib/utils";

export const HtmlPreviewLive = createContext(false);

const BUTTON_CLASS = "rounded p-1 transition-colors hover:bg-background hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

function HeaderButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} className={BUTTON_CLASS}>
      {children}
    </button>
  );
}

// 默认显示代码，访客点了 Preview 才挂 iframe 运行；挂上之后切回 Code 只隐藏不卸载，预览里的状态保留。
// 卡片按固定比例占位，流式输出与切换视图都不推动对话列表，内容超出在卡片内滚动。
export function ChatHtmlPreview({ source, children }: { source: string; children: ReactNode }) {
  const live = useContext(HtmlPreviewLive);
  const [view, setView] = useState<"code" | "preview">("code");
  const [run, setRun] = useState(0);
  const [copied, setCopied] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLPreElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const el = codeRef.current;
    if (live && el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [live, source]);

  function preview() {
    if (run === 0) setRun(1);
    setView("preview");
  }

  function copy() {
    navigator.clipboard.writeText(source).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }, () => {});
  }

  return (
    <div ref={cardRef} className="my-2 flex flex-col overflow-hidden rounded-md border border-line bg-background">
      <div className="flex items-center justify-between gap-2 border-b border-line bg-surface px-2 py-1 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5 font-mono">
          html
          {live && <LoaderCircle className="size-3 animate-spin" aria-label="Writing" />}
        </span>
        <div className="flex items-center gap-0.5">
          {view === "code" ? (
            <>
              <HeaderButton label={copied ? "Copied" : "Copy code"} onClick={copy} disabled={live}>
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              </HeaderButton>
              <HeaderButton label="Preview" onClick={preview} disabled={live}>
                <Play className="size-3.5" />
              </HeaderButton>
            </>
          ) : (
            <>
              <HeaderButton label="Restart" onClick={() => setRun(run + 1)}>
                <RotateCcw className="size-3.5" />
              </HeaderButton>
              {/* 预览视图只能由点击进入，这里已在浏览器里，不会和服务端渲染对不上。iPhone 的 Safari 不支持元素全屏。 */}
              {document.fullscreenEnabled && (
                <HeaderButton label="Full screen" onClick={() => void cardRef.current?.requestFullscreen().catch(() => {})}>
                  <Maximize className="size-3.5" />
                </HeaderButton>
              )}
              <HeaderButton label="Code" onClick={() => setView("code")}>
                <Code className="size-3.5" />
              </HeaderButton>
            </>
          )}
        </div>
      </div>
      <div className="relative aspect-[4/5] max-h-[70dvh] w-full sm:aspect-video [:fullscreen_&]:aspect-auto [:fullscreen_&]:max-h-none [:fullscreen_&]:flex-1">
        <pre
          ref={codeRef}
          onScroll={(event) => {
            const el = event.currentTarget;
            stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
          className={cn(
            "scrollbar-none absolute inset-0 overflow-auto bg-surface p-3 text-xs leading-relaxed [&::-webkit-scrollbar]:hidden [&_code]:block [&_code]:bg-transparent [&_code]:p-0",
            view !== "code" && "invisible",
          )}
        >
          {children}
        </pre>
        {run > 0 && (
          <iframe
            key={run}
            title="HTML preview"
            sandbox="allow-scripts"
            srcDoc={htmlPreviewDocument(source)}
            className={cn("absolute inset-0 size-full bg-white", view !== "preview" && "invisible")}
          />
        )}
      </div>
    </div>
  );
}
