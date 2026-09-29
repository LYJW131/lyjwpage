"use client";

import { useEffect, useRef } from "react";
import * as Sentry from "@sentry/nextjs";
import { catchError, type ErrorInfo } from "next/error";
import { RefreshCw, RotateCw } from "lucide-react";
import { useSWRConfig } from "swr";

import { Card } from "@/components/ui/card";
import { useVersionStatus } from "@/hooks/use-app-version";
import { createFaultLedger, describeFault, type FaultRecord } from "@/lib/card-recovery";
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
 * 兜底做三件事：
 * 1. 报 Sentry（app/error.tsx 也是这么做的；React 只把捕获到的错误打到 console，
 *    不会替我们上报），带 `card`、「页面此刻旧不旧」和已自动重试次数三个标签，一眼分得出
 *    是形状错位还是真有 bug。同一张卡同样的错在一轮里只报一次（lib/card-recovery）；
 * 2. 页面确知是旧的：直说「和站点对不上、刷新才能更新」。**不自动刷新**：一张卡出错就把
 *    整页刷掉，会打断人在别的卡片上的操作。躺在后台的旧页面由 components/stale-tab-reload
 *    刷新，前台只提示（再加上顶部的版本提示卡）；
 * 3. 页面不是旧的：可能是一次性的坏响应，给恢复的路 —— 兜底上有 Retry，另外自动重试几次
 *    （20 秒、1 分钟、3 分钟；页面在后台就等回到前台再试）。silent 的边界没有界面，
 *    也一样自动重试，而且页面旧着也试（更新提示就是给旧页面用的）。
 *
 * 恢复不是把 reset 一按就完：卡片一崩，整棵子树卸载，它的数据 hook 不再轮询；而让它崩的那份
 * 数据还躺在 SWR 缓存里，直接重新挂载会在渲染那一步又抛一次，连挂载时的回源（effect）
 * 都跑不到。所以重试前先把这张卡读的键（`paths`）从缓存里清掉：重新挂载时从首屏那份
 * 起步、再回源，新数据回来才有机会渲染成功。别的卡也在读的键，清掉时它们的 hook 正挂着，
 * 会立刻回源，用 keepPreviousData 撑着，读数不闪。
 */
type CardBoundaryProps = {
  /** 兜底卡片的标注，也是 Sentry 的 `card` 标签；取这张卡自己的标注，页面上要唯一 */
  label: string;
  /**
   * 这一格的版面类（跨列、defer-offscreen、估高）。兜底占同一格，网格才不塌、
   * 锚点跳转的估高才不失准。
   */
  className?: string;
  /** 不是一张卡（页头徽章、「正在播放」、更新提示）：出错只上报、原位什么都不画，也会自动重试 */
  silent?: boolean;
  /** 这张卡读的 SWR 键（状态端点路径）。重试前清掉，见上面的说明；没有就只重新渲染 */
  paths?: readonly string[];
};

/** 整页共享：恢复的节奏和上报去重按卡记账 */
const faults = createFaultLedger();

function CardFault({
  label,
  className,
  silent,
  paths,
  error,
  reset,
}: CardBoundaryProps & { error: unknown; reset: () => void }) {
  const { status } = useVersionStatus();
  const { mutate } = useSWRConfig();
  const stale = status === "stale";

  const recover = () => {
    for (const path of paths ?? []) void mutate(path, undefined, { revalidate: true });
    reset();
  };
  // 定时器和事件里要拿到最新的 recover，又不想因为它每次渲染都变引用而重排定时器
  const recoverRef = useRef(recover);
  useEffect(() => {
    recoverRef.current = recover;
  });

  // 这一轮崩溃只记一次账、报一次：兜底因为版本状态变化重新渲染，不算新的崩溃
  const episode = useRef<(FaultRecord & { reported: boolean }) | null>(null);
  useEffect(() => {
    episode.current ??= { ...faults.record(label, describeFault(error), Date.now()), reported: false };
    const current = episode.current;
    if (!current.report || current.reported) return;
    current.reported = true;
    Sentry.captureException(error, {
      tags: { boundary: "card", card: label, versionStatus: status, retries: String(current.attempt) },
    });
  }, [error, label, status]);

  // 自动重试。卡片在页面是旧的时候不试了：重试只会拿着同样错位的数据再崩一次，该刷新。
  // silent 的没有界面可以提示，而且更新提示本身就是给旧页面用的，照试（次数有限）
  useEffect(() => {
    const delay = episode.current?.retryInMs ?? null;
    if (delay === null || (stale && !silent)) return;
    let due = false;
    const attempt = () => {
      // 页面在后台就等回到前台再试：那时数据多半已经换过一轮
      if (!due || document.visibilityState === "hidden") return;
      due = false;
      recoverRef.current();
    };
    const timer = window.setTimeout(() => {
      due = true;
      attempt();
    }, delay);
    document.addEventListener("visibilitychange", attempt);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", attempt);
    };
  }, [stale, silent]);

  if (silent) return null;
  const button =
    "paper-card inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-line-strong bg-surface px-4 text-xs font-medium text-foreground transition-colors hover:bg-surface-hover";
  return (
    <Card label={label} tone="off" action="Unavailable" className={cn("h-full", className)}>
      <div className="flex min-h-28 flex-1 flex-col items-center justify-center gap-3 p-4 text-center">
        <p className="text-sm text-muted-foreground">
          {stale
            ? "This card is out of date with the site. Reload to update."
            : "This card hit an error and was paused."}
        </p>
        <div className="flex items-center gap-2">
          {!stale && (
            <button type="button" onClick={recover} className={button}>
              <RotateCw className="size-3" aria-hidden />
              <span>Retry</span>
            </button>
          )}
          <button type="button" onClick={() => window.location.reload()} className={button}>
            <RefreshCw className="size-3" aria-hidden />
            <span>Reload</span>
          </button>
        </div>
      </div>
    </Card>
  );
}

function CardFallback(props: CardBoundaryProps, { error, reset }: ErrorInfo) {
  return <CardFault {...props} error={error} reset={reset} />;
}

export const CardBoundary = catchError(CardFallback);
