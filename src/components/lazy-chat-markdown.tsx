import { useEffect, useSyncExternalStore } from "react";

import type { ChatMarkdown as ChatMarkdownComponent } from "@/components/chat-markdown";

type ChatMarkdownProps = { children: string; visuals?: boolean; streaming?: boolean };

// Markdown 只在有对话时渲染，整套依赖拆出首页路由块按需加载。不用 React.lazy：加载失败时它把错误抛给整张卡片的错误边界。
// 这里失败就一直显示纯文本：浏览器在同一文档里记住失败的模块、再 import 不会重发请求，恢复靠 asset-recovery-boot 的整页刷新。
let loaded: typeof ChatMarkdownComponent | undefined;
let pending: Promise<void> | undefined;
const listeners = new Set<() => void>();

export function preloadChatMarkdown() {
  pending ??= import("@/components/chat-markdown").then(
    (module) => {
      loaded = module.ChatMarkdown;
      for (const listener of listeners) listener();
    },
    () => {},
  );
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useChatMarkdownReady() {
  return useSyncExternalStore(subscribe, () => loaded !== undefined, () => false);
}

export function ChatMarkdown(props: ChatMarkdownProps) {
  const ready = useChatMarkdownReady();
  useEffect(() => {
    if (!ready) preloadChatMarkdown();
  }, [ready]);
  const Loaded = ready ? loaded : undefined;
  return Loaded ? <Loaded {...props} /> : <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">{props.children}</div>;
}
