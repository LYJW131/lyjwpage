import Image from "next/image";

import { PsPlusMark } from "@/components/trophies/ps-plus";
import { TrophyMetal, trophyTypeLabel } from "@/components/trophies/trophy-metal";
import { site } from "@/lib/site";
import type {
  StatusResponse,
  TrophiesSummaryPayload,
  TrophyType,
  TrophyUnlock,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const TYPES: TrophyType[] = ["platinum", "gold", "silver", "bronze"];

function formatUnlock(ms: number): string {
  // 「6月22日」而不是「6/22」—— 斜杠版和旁边的 442 / 1466 长得太像分数
  return new Date(ms).toLocaleString("zh-CN", {
    timeZone: site.timezone,
    month: "long",
    day: "numeric",
  });
}

function Count({ type, value }: { type: TrophyType; value: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <TrophyMetal kind={type} size="sm" />
      <div className="leading-tight">
        <div className="label-mono text-muted-foreground">{trophyTypeLabel(type)}</div>
        <div className="text-sm font-medium tabular-nums">{value}</div>
      </div>
    </div>
  );
}

/**
 * 首屏提要。只吃服务端裁过的摘要，不订阅 /api/status/trophies ——
 * 那个端点是整份目录，点瓷砖展开才去拉；和这里的形状不是一份，
 * 塞进同一个 SWR 键会互相冲掉。
 */
export function TrophyTeaser({
  fallback,
  embedded = false,
  onRecentClick,
}: {
  fallback: StatusResponse<TrophiesSummaryPayload>;
  /** 嵌在 PlayStation 整块里：不再自己套一张纸卡片，也不重复「陈列室」。 */
  embedded?: boolean;
  /**
   * 点「最近解锁」。函数 prop 过不了服务端边界，所以给它的那层必须是
   * 客户端组件（playstation-panel）。
   */
  onRecentClick: (unlock: TrophyUnlock) => void;
}) {
  if (!fallback.ok) return null;
  const data = fallback.data;
  const recent = data.recent[0];

  return (
    <div
      className={cn(
        "flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:gap-5",
        embedded
          ? "border-b border-line"
          : "paper-card mb-3 border border-line-strong bg-surface",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {/*
         * 环画的是当前等级内的进度，具体点数没地方摆 —— 挂 title 让它至少悬停可见。
         * title 放在外层 div 上而不是 svg 上：svg 有 aria-hidden，读屏和悬停走同一个盒子更稳。
         */}
        <div
          className="relative grid h-14 w-14 shrink-0 place-items-center"
          title={`${data.profile.trophyPoint.toLocaleString("en-US")} / ${data.profile.levelNextPoint.toLocaleString("en-US")} 点`}
        >
          <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90 text-line" aria-hidden>
            <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="2.5" />
            <circle
              cx="18"
              cy="18"
              r="15"
              fill="none"
              className="text-foreground"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeDasharray={2 * Math.PI * 15}
              strokeDashoffset={2 * Math.PI * 15 * (1 - data.profile.levelProgress / 100)}
              strokeLinecap="butt"
            />
          </svg>
          {data.profile.avatarUrl ? (
            <Image
              src={data.profile.avatarUrl}
              alt={data.profile.onlineId}
              width={40}
              height={40}
              className="h-10 w-10 rounded-full object-cover"
            />
          ) : (
            <TrophyMetal kind="level" size="md" className="h-8 w-8" />
          )}
        </div>
        <div className="min-w-0 leading-tight">
          <div className="flex items-center gap-1.5">
            {/* PSN ID 大小写有意义，不能走会转大写的 label-mono */}
            <span className="truncate text-sm font-medium">{data.profile.onlineId}</span>
            {/* 图标不带字：位置贴着 ID 已经说明是会员标，语义留给 aria-label */}
            {data.profile.plus ? <PsPlusMark className="h-3.5 w-3.5" /> : null}
          </div>
          <div className="label-mono mt-1.5 text-muted-foreground">
            奖杯等级 {data.profile.level}
          </div>
        </div>
      </div>

      {/*
       * 四色计数按内容宽，不再 flex-1 摊满：摊满时四个两位数被推得老远，
       * 中间全是空的。左右两块可伸缩，让它们去吃剩下的空间。
       */}
      <div className="grid grid-cols-4 gap-2 border-t border-line pt-3 sm:shrink-0 sm:gap-5 sm:border-t-0 sm:pt-0">
        {TYPES.map((type) => (
          <Count key={type} type={type} value={data.earned[type]} />
        ))}
      </div>

      {/* 中间那块不再撑开，靠 ml-auto 把这块推回右边缘 */}
      {recent ? (
        <div className="min-w-0 border-t border-line pt-3 sm:ml-auto sm:max-w-64 sm:border-t-0 sm:pt-0 sm:text-right">
          {/*
           * 整块可点：它就是「展开下面那款游戏的奖杯」的按钮。
           * 负外边距配等量内边距，悬停的底色比文字宽一圈，文字本身仍旧
           * 和上面那组计数对齐（block 的 width: auto 会把负外边距吃回来，
           * 所以不能再写 w-full）。
           */}
          <button
            type="button"
            onClick={() => onRecentClick(recent)}
            // 游戏名自带书名号的时候多，别再套一层
            aria-label={`展开 ${recent.titleName} 的奖杯，定位到「${recent.trophyName}」`}
            className="-mx-2 block cursor-pointer rounded-md px-2 py-1 text-left transition-colors hover:bg-surface-hover sm:text-right"
          >
            {/* 和四色计数同构：标签在上、内容在下 —— 裸内容一眼认不出是什么。
                日期跟着标签走，别插在图标和奖杯名中间把名字拆开 */}
            <div className="label-mono text-muted-foreground">
              最近解锁 · {formatUnlock(recent.earnedAt)}
            </div>
            <div className="mt-1.5 flex items-center gap-2 sm:justify-end">
              {recent.iconUrl ? (
                <Image
                  src={recent.iconUrl}
                  alt=""
                  width={28}
                  height={28}
                  className="h-7 w-7 shrink-0 object-cover"
                />
              ) : null}
              <div className="min-w-0 truncate text-sm">
                {recent.trophyName}
                <span className="text-muted-foreground"> · {recent.titleName}</span>
              </div>
            </div>
          </button>
        </div>
      ) : null}
    </div>
  );
}
