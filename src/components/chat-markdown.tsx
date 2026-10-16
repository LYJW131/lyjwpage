import { createContext, memo, useContext, type ReactNode } from "react";
import Markdown, { type Components, type ExtraProps } from "react-markdown";

import { ChatHtmlPreview } from "@/components/chat-html-preview";
import { ChatVisualView, VisualPlaceholder } from "@/components/chat-visual";
import { CHAT_REMARK_PLUGINS, CHAT_STREAM_REHYPE_PLUGINS } from "@/lib/chat-markdown-plugins";
import { isVisualKind, parsePartialVisual, parseVisual } from "@/lib/chat-visuals";

const LINK_CLASS = "underline underline-offset-2 hover:opacity-80";

const InsideLink = createContext(false);
const Streaming = createContext(false);

function ImageLink({ src, alt }: { src?: unknown; alt?: string }) {
  const insideLink = useContext(InsideLink);
  if (insideLink) return <>{alt || "image"}</>;
  if (typeof src !== "string" || !src) return <>{alt}</>;
  return (
    <a href={src} target="_blank" rel="noreferrer noopener" className={LINK_CLASS}>
      {alt || "image"}
    </a>
  );
}

function fencedBlock(node: ExtraProps["node"]): { language: string; source: string } | null {
  const code = node?.children[0];
  if (node?.children.length !== 1 || code?.type !== "element" || code.tagName !== "code") return null;
  const classes = code.properties.className;
  const language = Array.isArray(classes) ? classes.find((name) => typeof name === "string" && name.startsWith("language-")) : undefined;
  if (typeof language !== "string") return null;
  return { language: language.slice("language-".length), source: code.children.map((child) => (child.type === "text" ? child.value : "")).join("") };
}

// 流式期间图示代码块带着写到一半的源码（见 stableMarkdown）：JSON 图示画已写完的条目，一条都没有时画占位；
// 回复结束后按整块校验，不过就照原样显示代码。
function ReplyBlock({ node, children }: { node: ExtraProps["node"]; children: ReactNode }) {
  const streaming = useContext(Streaming);
  const block = fencedBlock(node);
  if (block?.language === "html") return <ChatHtmlPreview source={block.source} streaming={streaming} />;
  if (!block || !isVisualKind(block.language)) return <CodeBlock>{children}</CodeBlock>;
  if (!block.source.trim()) return <VisualPlaceholder kind={block.language} />;
  const visual = streaming ? parsePartialVisual(block.language, block.source) : parseVisual(block.language, block.source);
  if (visual) return <ChatVisualView visual={visual} />;
  return streaming ? <VisualPlaceholder kind={block.language} /> : <CodeBlock>{children}</CodeBlock>;
}

function CodeBlock({ children }: { children: ReactNode }) {
  return (
    <pre
      className="scrollbar-none my-2 overflow-x-auto rounded-md border border-line bg-surface p-3 text-xs leading-relaxed [&::-webkit-scrollbar]:hidden [&_code]:block [&_code]:bg-transparent [&_code]:p-0"
    >
      {children}
    </pre>
  );
}

const COMPONENTS: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener" className={LINK_CLASS}>
      <InsideLink.Provider value>{children}</InsideLink.Provider>
    </a>
  ),
  // 回复和思考摘要里的图片只给链接不加载：模型（或经联网搜索读到的注入文本）能把对话内容拼进图片 URL，浏览器渲染即发请求，无需点击就外带出去。
  img: ({ src, alt }) => <ImageLink src={src} alt={alt} />,
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  table: ({ children }) => (
    <div className="scrollbar-none my-2 overflow-x-auto [&::-webkit-scrollbar]:hidden">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
};

const REPLY_COMPONENTS: Components = {
  ...COMPONENTS,
  pre: ({ node, children }) => <ReplyBlock node={node}>{children}</ReplyBlock>,
};

export const ChatMarkdown = memo(function ChatMarkdown({ children, visuals = false, streaming = false }: { children: string; visuals?: boolean; streaming?: boolean }) {
  return (
    <div
      className={[
        "[overflow-wrap:anywhere] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        "[&_p]:my-2 [&_ul]:my-2 [&_ol]:my-2 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_li]:my-0.5",
        "[&_h1]:mt-3 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-bold [&_h2]:mt-3 [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-bold [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:font-semibold",
        "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-line-strong [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        "[&_code]:rounded [&_code]:bg-surface [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
        "[&_hr]:my-3 [&_hr]:border-line [&_strong]:font-semibold",
        "[&_th]:border [&_th]:border-line [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:border-line [&_td]:px-2 [&_td]:py-1",
      ].join(" ")}
    >
      <Streaming.Provider value={streaming}>
        <Markdown remarkPlugins={CHAT_REMARK_PLUGINS} rehypePlugins={streaming ? CHAT_STREAM_REHYPE_PLUGINS : undefined} components={visuals ? REPLY_COMPONENTS : COMPONENTS}>
          {children}
        </Markdown>
      </Streaming.Provider>
    </div>
  );
});
