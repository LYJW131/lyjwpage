import { lazy, Suspense } from "react";

type ChatMarkdownProps = { children: string; visuals?: boolean };

// react-markdown 与 remark 插件约占首页路由块 60 KB gzip，而 Markdown 只在有对话时才渲染，拆成独立块按需加载。
const loadChatMarkdown = () => import("@/components/chat-markdown");

const ChatMarkdownImpl = lazy(() => loadChatMarkdown().then((module) => ({ default: module.ChatMarkdown })));

export function preloadChatMarkdown() {
  void loadChatMarkdown();
}

export function ChatMarkdown(props: ChatMarkdownProps) {
  return (
    <Suspense fallback={<div className="whitespace-pre-wrap [overflow-wrap:anywhere]">{props.children}</div>}>
      <ChatMarkdownImpl {...props} />
    </Suspense>
  );
}
