"use client";

import { useEffect, useRef } from "react";
import * as Sentry from "@sentry/nextjs";
import { catchError, type ErrorInfo } from "next/error";
import { RotateCw } from "lucide-react";

import { Card } from "@/components/ui/card";
import { useVersionStatus } from "@/hooks/use-app-version";
import { useStaleAutoReload } from "@/hooks/use-stale-auto-reload";
import { cn } from "@/lib/utils";

/**
 * 逐卡的错误边界：一张卡渲染时抛错，只有这一格退成「Unavailable」，别的卡和整页照常。
 *
 * 为什么每张卡都要有。各卡读的是 Worker 直接给的 JSON，Worker 和站点分头部署，
 * 有两种时候形状对不上：部署那几分钟，以及浏览器里放了很久的旧标签页（旧脚本、新数据）。
 * 没有边界时一张卡抛错会一路冒到 app/error.tsx，整页换成「Something went wrong」——
 * LYJWPAGE-5 / 6 就是这样，一张限额、一张 Pulse，各自带垮了整页。
 *
 * 用 Next 自带的 `catchError`（next/error）而不是手写 class：它把 `redirect()` /
 * `notFound()` 这类靠抛错实现的东西原样放行，客户端导航时也会自己清掉错误态。
 *
 * 兜底做两件事：
 * 1. 报 Sentry（app/error.tsx 也是这么做的；React 只把捕获到的错误打到 console，
 *    不会替我们上报），带 `card` 和「页面此刻旧不旧」两个标签，一眼分得出是形状
 *    错位还是真有 bug；
 * 2. 已经确知页面是旧的就直接刷新（hooks/use-stale-auto-reload），刷新就是修复。
 *    不是旧的就停在兜底上：错误态不自愈，刷新页面或下次客户端导航才会清掉。
 */
type CardBoundaryProps = {
  /** 兜底卡片的标注，也是 Sentry 的 `card` 标签；取这张卡自己的标注 */
  label: string;
  /**
   * 这一格的版面类（跨列、defer-offscreen、估高）。兜底占同一格，网格才不塌、
   * 锚点跳转的估高才不失准。
   */
  className?: string;
  /** 不是一张卡（页头徽章、「正在播放」、更新提示）：出错只上报，原位什么都不画 */
  silent?: boolean;
};

function CardFault({ label, className, silent, error }: CardBoundaryProps & { error: unknown }) {
  const { status } = useVersionStatus();
  // 兜底重新渲染也不重复上报；标签取第一次上报时页面已知的版本状态
  const reported = useRef(false);
  useEffect(() => {
    if (reported.current) return;
    reported.current = true;
    Sentry.captureException(error, { tags: { boundary: "card", card: label, versionStatus: status } });
  }, [error, label, status]);
  useStaleAutoReload("crash");

  if (silent) return null;
  return (
    <Card label={label} tone="off" action="Unavailable" className={cn("h-full", className)}>
      <div className="flex min-h-28 flex-1 flex-col items-center justify-center gap-3 p-4 text-center">
        <p className="text-sm text-muted-foreground">This card hit an error and was paused.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="paper-card inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-line-strong bg-surface px-4 text-xs font-medium text-foreground transition-colors hover:bg-surface-hover"
        >
          <RotateCw className="size-3" aria-hidden />
          <span>Reload</span>
        </button>
      </div>
    </Card>
  );
}

function CardFallback(props: CardBoundaryProps, { error }: ErrorInfo) {
  return <CardFault {...props} error={error} />;
}

export const CardBoundary = catchError(CardFallback);
