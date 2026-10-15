import { startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

import { DOCUMENT_COMMIT_META } from "@/lib/app-version";
import { commitSha } from "@/lib/build-info";
import { installGlobalErrorReporting, reportError } from "@/lib/error-report";

installGlobalErrorReporting();

// 水合报错的消息只有 React 错误码和文档链接；换成按错误码归组的固定消息，组件栈当 stack 才指得出哪棵树没对上。
function reportRecoverableError(error: unknown, componentStack: string | undefined) {
  console.error(error);
  const message = error instanceof Error ? error.message : String(error);
  const code = /#(\d+)/.exec(message)?.[1] ?? "unknown";
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : null;
  const report = new Error(`Hydration fell back to client rendering (${code})`);
  report.name = "HydrationFallback";
  if (componentStack) report.stack = `${report.name}: ${report.message}${componentStack}`;
  const htmlCommit = document.querySelector(`meta[name="${DOCUMENT_COMMIT_META}"]`)?.getAttribute("content") ?? null;
  reportError(report, "hydration", {
    "react.code": code,
    "html.current": String(htmlCommit === commitSha),
    ...(cause ? { "react.cause": `${cause.name}: ${cause.message}` } : {}),
  });
}

function hydrate() {
  startTransition(() => {
    hydrateRoot(document, <HydratedRouter />, {
      onRecoverableError: (error, errorInfo) => reportRecoverableError(error, errorInfo.componentStack),
    });
  });
}

// 先让浏览器画出服务端 HTML，再分片水合：同步水合是一整个长任务，慢机上会把首帧压到它跑完之后。后台标签页不跑 requestAnimationFrame，等它会让页面切回前台前一直不水合。
if (document.visibilityState === "hidden") hydrate();
else requestAnimationFrame(() => setTimeout(hydrate, 0));
