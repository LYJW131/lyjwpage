import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { confirmExternalOpen } from "@/components/external-link-guard";
import { cn } from "@/lib/utils";
import {
  HTML_VISUAL_HEIGHT_KEY,
  HTML_VISUAL_OPEN_KEY,
  HTML_VISUAL_SOURCE_KEY,
  HTML_VISUAL_THEME_VARS,
  htmlVisualDocument,
  visualHeight,
  visualLink,
  type HtmlVisualTheme,
} from "@/lib/html-preview";

const PLACEHOLDER_HEIGHT = 128;
// 流式期间推源码的最短间隔：每次推送都整体替换 iframe 里的 DOM，按放字的帧率推太密。
const STREAM_PUSH_MS = 100;

function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
  return () => observer.disconnect();
}

const themeScheme = () => (document.documentElement.classList.contains("dark") ? "dark" : "light");

function fontFaces(): string {
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) if (rule instanceof CSSFontFaceRule) rules.push(rule.cssText);
    } catch {
      // 跨源样式表读不了规则，站点字体都在自家样式表里。
    }
  }
  return rules.join("");
}

function readTheme(scheme: "light" | "dark"): HtmlVisualTheme {
  const root = getComputedStyle(document.documentElement);
  const vars = Object.fromEntries(Object.entries(HTML_VISUAL_THEME_VARS).map(([name, source]) => [name, root.getPropertyValue(source).trim()]));
  return { scheme, vars, font: getComputedStyle(document.body).fontFamily, fontSize: "0.875rem", fontFaces: fontFaces() };
}

// 回复里的 html 代码块直接画在正文里：没有边框和切换，透明底、站点字体与配色，高度随内容。
// 源码经 postMessage 推进 iframe、替换 body，流式期间边写边画，iframe 不重载；innerHTML 不执行脚本，
// 所以带 <script> 的图示在回复结束后改成把源码写进 srcdoc 整页加载一次，脚本才会跑。
export function ChatHtmlPreview({ source, streaming = false }: { source: string; streaming?: boolean }) {
  const scheme = useSyncExternalStore(subscribeTheme, themeScheme, () => null);
  const [height, setHeight] = useState<number | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const sourceRef = useRef(source);
  const lastPush = useRef(0);
  const pushed = streaming || !/<script/i.test(source);
  const push = () => {
    lastPush.current = Date.now();
    frameRef.current?.contentWindow?.postMessage({ [HTML_VISUAL_SOURCE_KEY]: sourceRef.current.replace(/^\s*<!doctype[^>]*>/i, "") }, "*");
  };

  useEffect(() => {
    sourceRef.current = source;
    if (!pushed) return;
    const timer = setTimeout(push, Math.max(0, lastPush.current + STREAM_PUSH_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [source, pushed]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) return;
      const data = event.data as Record<string, unknown> | null;
      const next = visualHeight(data?.[HTML_VISUAL_HEIGHT_KEY]);
      if (next !== null) setHeight(next);
      const link = visualLink(data?.[HTML_VISUAL_OPEN_KEY]);
      // 和正文里的 Markdown 链接一样只在访客点击时打开：图示里的脚本自己发消息，没有点击就开不了标签页。
      // 用户激活对整页有效，所以还要求焦点在这块图示上，访客点站点别处时图示脚本借不到这次激活。
      if (link && navigator.userActivation?.isActive && document.activeElement === frameRef.current) confirmExternalOpen(link);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const doc = scheme !== null && source.trim() !== "" ? htmlVisualDocument(pushed ? "" : source, readTheme(scheme), window.location.origin) : null;
  return (
    <div className={cn("my-3", height === null && "animate-pulse rounded-md bg-surface")} style={height === null ? { minHeight: PLACEHOLDER_HEIGHT } : undefined}>
      {doc !== null && (
        <iframe
          ref={frameRef}
          title="Visual"
          sandbox="allow-scripts"
          srcDoc={doc}
          onLoad={pushed ? push : undefined}
          className="block w-full bg-transparent"
          style={{ height: height ?? PLACEHOLDER_HEIGHT, colorScheme: scheme ?? undefined }}
        />
      )}
    </div>
  );
}
