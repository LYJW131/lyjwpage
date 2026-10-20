import { createContext, useContext } from "react";

import { streamTokens } from "@/lib/chat-markdown-plugins";

export const Streaming = createContext(false);

// 流式时图示里的文字和正文一样拆成 stream-token 逐个淡入；按位置对齐，已经在的字不重播，回复结束后换回纯文本。
export function Ink({ children }: { children: string }) {
  const streaming = useContext(Streaming);
  if (!streaming) return children;
  return streamTokens(children).map((token, i) => (/^\s+$/.test(token) ? token : <span key={i} className="stream-token">{token}</span>));
}

export function Heading({ title, subtitle }: { title?: string; subtitle?: string }) {
  if (!title && !subtitle) return null;
  return (
    <div className="mb-2">
      {title && <div className="font-semibold"><Ink>{title}</Ink></div>}
      {subtitle && <div className="text-xs text-muted-foreground"><Ink>{subtitle}</Ink></div>}
    </div>
  );
}
