import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import type { Mounted } from "pele/lazy";

import { SERIES_COLORS, VisualFrame } from "@/components/chat-visual";
import { cn } from "@/lib/utils";

const PLACEHOLDER_HEIGHT = 160;

// Pele 的配色全走 CSS 变量，换主题不用重画；这里接到站点色板，圆角归零与站点一致（状态图等节点自带 rx，不认 --pele-radius，另用 CSS 的 rx 压平）。字体不设，mount 读宿主元素的计算样式，跟正文一致。
const THEME = {
  "--pele-bg": "transparent",
  "--pele-fg": "var(--foreground)",
  "--pele-muted": "var(--muted-foreground)",
  "--pele-line": "var(--muted-foreground)",
  "--pele-surface": "var(--surface)",
  "--pele-surface-alt": "var(--muted)",
  "--pele-border": "var(--line-strong)",
  "--pele-accent": "var(--signal-blue)",
  "--pele-error": "var(--signal-red)",
  "--pele-critical": "var(--signal-red)",
  "--pele-radius": "0px",
  ...Object.fromEntries(SERIES_COLORS.map((color, index) => [`--pele-series-${index + 1}`, color])),
} as CSSProperties;

// 链接和图片都关掉：模型（或联网读到的注入文本）能把对话内容拼进 URL，图片渲染即外带。
const OPTIONS = { links: false, images: false, zoom: false } as const;

type State = "loading" | "drawn" | "failed";

// 回复里的 mermaid 代码块用 Pele 画成 SVG，库按需加载、各图种再按需取。流式期间源码边写边重画，
// 写到一半解析不过时 Pele 保留上一张能画的图，这里把它的错误提示藏起来；回复结束后仍画不出就退回成代码。
export function ChatMermaid({ source, streaming, fallback }: { source: string; streaming: boolean; fallback: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const mounted = useRef<Mounted | null>(null);
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let cancelled = false;
    // 同步的 update 不会去取新图种：流式开头只写出半个关键字（如 sequenceD），先 mount 再 update 会一直停在「不支持」，
    // 所以每次都先按当前源码 load 对应图种。
    import("pele/lazy")
      .then(async (pele) => {
        await pele.load(pele.detectType(source));
        if (cancelled) return;
        if (mounted.current) mounted.current.update(source, OPTIONS);
        else mounted.current = pele.mount(element, source, OPTIONS);
        const view = mounted.current;
        setState(view.result && (streaming || view.error === undefined) ? "drawn" : streaming ? "loading" : "failed");
      })
      .catch(() => !cancelled && setState(streaming ? "loading" : "failed"));
    return () => {
      cancelled = true;
    };
  }, [source, streaming]);

  useEffect(() => () => mounted.current?.destroy(), []);

  if (state === "failed") return <>{fallback}</>;
  return (
    <VisualFrame className="relative text-xs" style={{ minHeight: state === "drawn" ? undefined : PLACEHOLDER_HEIGHT }}>
      {state === "loading" && <div className="absolute inset-0 animate-pulse bg-surface" />}
      <div ref={host} style={THEME} className={cn("[&>svg]:mx-auto [&_rect]:[rx:0]", streaming && "[&_.pele-error]:hidden [&>svg]:!opacity-100")} />
    </VisualFrame>
  );
}
