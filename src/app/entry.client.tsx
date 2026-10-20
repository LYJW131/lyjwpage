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

let hydrated = false;

function hydrate() {
  if (hydrated) return;
  hydrated = true;
  startTransition(() => {
    hydrateRoot(document, <HydratedRouter />, {
      onRecoverableError: (error, errorInfo) => reportRecoverableError(error, errorInfo.componentStack),
    });
  });
}

// 入口加载由 deferModulePreloads 统一让出绘制机会；这里再等动画帧会重复延后可交互时间。
hydrate();
