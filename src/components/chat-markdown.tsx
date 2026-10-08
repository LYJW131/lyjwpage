import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const COMPONENTS: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2 hover:opacity-80">
      {children}
    </a>
  ),
  pre: ({ children }) => (
    <pre
      className="scrollbar-none my-2 overflow-x-auto rounded-md border border-line bg-surface p-3 text-xs leading-relaxed [&::-webkit-scrollbar]:hidden [&_code]:block [&_code]:bg-transparent [&_code]:p-0"
    >
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="scrollbar-none my-2 overflow-x-auto [&::-webkit-scrollbar]:hidden">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
};

export function ChatMarkdown({ children }: { children: string }) {
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
      <Markdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {children}
      </Markdown>
    </div>
  );
}
