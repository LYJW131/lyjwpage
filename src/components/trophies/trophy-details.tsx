"use client";

import { EyeOff } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import useSWR from "swr";

import { TrophyMetal } from "@/components/trophies/trophy-metal";
import { LIST_TRANSITION, STATIC_TRANSITION } from "@/lib/motion";
import { trophiesTilePath } from "@/lib/paths";
import { site } from "@/lib/site";
import type { StatusResponse, TrophiesPayload, Trophy, TrophyTitle } from "@/lib/types";
import { cn } from "@/lib/utils";

const CATALOG_REFRESH_MS = 10 * 60_000;

/** 和 Recently Played 那列同一套：五行填满、停滚后吸到整行。 */
const VISIBLE_ROWS = 5;
const MIN_ROW_HEIGHT_PX = 56;
const SETTLE_DELAY_MS = 110;
const SUSPEND_AFTER_CHANGE_MS = 500;

/**
 * 列宽跟游戏瓷砖同一套公式（见 playstation-card TILE_TRACK）：
 * 默认 1 列、md 2、lg 3；减掉的是 gap-3。
 * 只有两组时始终并排，不被 1 列挤成一张、也不在 lg 上空出第三列。
 */
function groupTrack(count: number) {
  return cn(
    "grid grid-flow-col grid-rows-1 gap-3",
    count <= 2
      ? "auto-cols-[calc((100%-0.75rem)/2)]"
      : [
          "auto-cols-[100%]",
          "md:auto-cols-[calc((100%-0.75rem)/2)]",
          "lg:auto-cols-[calc((100%-1.5rem)/3)]",
        ],
  );
}

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

function formatStamp(ms: number): string {
  return new Date(ms).toLocaleString("zh-CN", {
    timeZone: site.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function trophyDetail(trophy: Trophy): string | null {
  if (trophy.hidden && !trophy.earned) return "解锁后显示";
  return trophy.detail;
}

function rarityLabel(rate: number | null): string {
  if (rate == null) return "—";
  if (rate < 5) return "极稀有";
  if (rate < 15) return "非常稀有";
  if (rate < 50) return "稀有";
  return "常见";
}

async function fetchCatalog(path: string): Promise<StatusResponse<TrophiesPayload>> {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`请求 ${path} 失败：${response.status}`);
  return response.json();
}

/**
 * 点开瓷砖才拉奖杯明细，不进首屏 HTML；拉的也只是这块瓷砖对上的那 1–2 款
 * （服务端按 titleIds 切，键就是切片本身，见 lib/paths 的 trophiesTilePath）。
 * 每块打开过的瓷砖各占一个键，关掉面板 SWR 仍留着那份缓存。
 *
 * `null` 表示当前没有展开的瓷砖，不取数。
 *
 * 从前整份目录只有一个键，可以开 keepPreviousData；现在键跟着展开的瓷砖走，
 * 开着就是在 B 的面板里摆着 A 的奖杯，直到 B 那次请求回来 —— 宁可显示加载态。
 */
export function useTrophyCatalog(titleIds: string[] | null) {
  const key = titleIds ? trophiesTilePath(titleIds) : null;
  const { data, error, isLoading } = useSWR<StatusResponse<TrophiesPayload>>(
    key,
    fetchCatalog,
    {
      refreshInterval: key ? CATALOG_REFRESH_MS : 0,
      shouldRetryOnError: false,
    },
  );
  return {
    titles: data?.ok ? data.data.titles : undefined,
    error: data && !data.ok ? data.error : error ? String(error.message ?? error) : undefined,
    isLoading,
  };
}

/**
 * 保证列表永远停在整行上。理由和实现照搬 Recently Played：不用 CSS
 * scroll-snap，只在用户停滚之后对齐到最近的整行。
 */
function useRowSnap(topKey: string | undefined) {
  const node = useRef<HTMLDivElement | null>(null);
  const previous = useRef(topKey);
  const suspendUntil = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useIsomorphicLayoutEffect(() => {
    if (previous.current === topKey) return;
    previous.current = topKey;
    suspendUntil.current = Date.now() + SUSPEND_AFTER_CHANGE_MS;

    const el = node.current;
    if (!el || el.scrollTop === 0) return;
    const saved = el.style.scrollBehavior;
    el.style.scrollBehavior = "auto";
    el.scrollTop = 0;
    el.style.scrollBehavior = saved;
  }, [topKey]);

  return useCallback((el: HTMLDivElement | null) => {
    node.current = el;
    if (!el) return;

    const onScroll = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (Date.now() < suspendUntil.current) return;
        const rowHeight = el.clientHeight / VISIBLE_ROWS;
        const target = Math.round(el.scrollTop / rowHeight) * rowHeight;
        if (Math.abs(target - el.scrollTop) < 0.5) return;
        el.scrollTo({ top: target, behavior: "smooth" });
      }, SETTLE_DELAY_MS);
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (timer.current) clearTimeout(timer.current);
      node.current = null;
    };
  }, []);
}

function TrophyRow({ trophy }: { trophy: Trophy }) {
  const hidden = trophy.hidden && !trophy.earned;
  const locked = !trophy.earned;
  const subtitle =
    trophyDetail(trophy) ??
    (trophy.earned && trophy.earnedAt ? formatStamp(trophy.earnedAt) : "未解锁");
  const rarity = trophy.earnedRate != null ? rarityLabel(trophy.earnedRate) : null;
  return (
    <div className="flex h-full items-center gap-2.5 rounded-md px-2 transition-colors hover:bg-surface-hover">
      <div
        className={cn(
          "relative size-11 shrink-0 overflow-hidden rounded-sm border border-line bg-muted",
          locked && !hidden && "grayscale",
          hidden && "border-dashed",
        )}
      >
        {trophy.iconUrl && !hidden ? (
          <Image
            src={trophy.iconUrl}
            alt=""
            fill
            sizes="44px"
            className={cn("object-cover", locked && "opacity-55")}
          />
        ) : (
          <div className="grid h-full place-items-center text-muted-foreground">
            {hidden ? (
              <EyeOff className="size-4" strokeWidth={1.75} />
            ) : (
              <TrophyMetal kind={trophy.type} size="sm" />
            )}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <TrophyMetal
            kind={trophy.type}
            size="sm"
            className={cn(locked && "grayscale opacity-55")}
          />
          <span
            className={cn("min-w-0 truncate text-sm", locked && "text-muted-foreground")}
            title={hidden ? "隐藏奖杯" : trophy.name}
          >
            {hidden ? "隐藏奖杯" : trophy.name}
          </span>
          {/* 未解锁只靠灰阶和半透明表达，读屏取不到，补一句文本 */}
          {locked ? <span className="sr-only">未解锁</span> : null}
        </div>
        <div
          className="truncate text-xs text-muted-foreground"
          title={rarity ? `${rarity} · ${subtitle}` : subtitle}
        >
          {rarity ? `${rarity} · ` : ""}
          {subtitle}
        </div>
      </div>
    </div>
  );
}

function GroupSlot({
  groups,
  resetKey,
}: {
  groups: { key: string; group: TrophyTitle["groups"][number] }[];
  resetKey: string | undefined;
}) {
  const reduced = useReducedMotion();
  const cached = useRef(groups);
  if (groups.length) cached.current = groups;
  const open = groups.length > 0;

  return (
    <motion.div
      data-trophy-groups-wrap=""
      initial={false}
      animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
      transition={reduced ? STATIC_TRANSITION : LIST_TRANSITION}
      className="overflow-hidden"
    >
      {cached.current.length ? (
        // 收起时高度是 0 但节点还在：光 aria-hidden 挡不住 tab 键，焦点还是能
        // 落进这条看不见的横滚区。inert 一次把 tab 序和读屏都摘掉。
        <div data-trophy-groups="" className="pb-2" inert={!open}>
          <GroupStrip groups={cached.current} resetKey={resetKey} />
        </div>
      ) : null}
    </motion.div>
  );
}

function GroupStrip({
  groups,
  resetKey,
}: {
  groups: { key: string; group: TrophyTitle["groups"][number] }[];
  resetKey: string | undefined;
}) {
  const node = useRef<HTMLDivElement | null>(null);
  const previous = useRef(resetKey);

  useIsomorphicLayoutEffect(() => {
    if (previous.current === resetKey) return;
    previous.current = resetKey;
    const el = node.current;
    if (!el || el.scrollLeft === 0) return;
    const saved = el.style.scrollBehavior;
    el.style.scrollBehavior = "auto";
    el.scrollLeft = 0;
    el.style.scrollBehavior = saved;
  }, [resetKey]);

  return (
    <div
      ref={node}
      tabIndex={0}
      role="region"
      aria-label="奖杯组"
      className={cn(
        "scroll-smooth overflow-x-auto overscroll-x-contain",
        "snap-x snap-mandatory",
        "scrollbar-none [&::-webkit-scrollbar]:hidden",
      )}
    >
      <div className={groupTrack(groups.length)}>
        {groups.map(({ key, group }) => (
          <div key={key} className="min-w-0 snap-start">
            <div className="flex items-stretch overflow-hidden border border-line bg-surface">
              {group.iconUrl ? (
                <div className="relative w-10 shrink-0 self-stretch overflow-hidden border-r border-line bg-muted">
                  <Image
                    src={group.iconUrl}
                    alt=""
                    fill
                    sizes="40px"
                    className="object-cover"
                  />
                </div>
              ) : null}
              <div className="min-w-0 flex-1 px-2 py-1.5">
                <div className="truncate text-xs font-medium">{group.name}</div>
                <div className="label-mono text-muted-foreground">{group.progress}%</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrophyViewport({
  listRef,
  children,
}: {
  listRef?: (el: HTMLDivElement | null) => void;
  children: ReactNode;
}) {
  return (
    <div className="relative" style={{ height: MIN_ROW_HEIGHT_PX * VISIBLE_ROWS }}>
      <div
        ref={listRef}
        tabIndex={0}
        role="region"
        aria-label="奖杯"
        className={cn(
          "absolute inset-0 grid overflow-y-auto",
          "scroll-smooth overscroll-y-contain [overflow-anchor:none]",
          "scrollbar-none [&::-webkit-scrollbar]:hidden",
        )}
        style={{ gridAutoRows: `calc(100% / ${VISIBLE_ROWS})` }}
      >
        {children}
      </div>
    </div>
  );
}

export function TrophyExpand({
  name,
  titles,
  loading,
  error,
  knownEmpty = false,
}: {
  name: string;
  titles: TrophyTitle[] | undefined;
  loading: boolean;
  error?: string;
  /**
   * 摘要**收到了**、里面这张卡就没有奖杯组，于是不必先铺 5 行再收。
   * 摘要本身没来（信封 !ok）时必须是 false —— 那是「不知道」，不是「没有」。
   */
  knownEmpty?: boolean;
}) {
  const trophies = titles?.flatMap((title) =>
    title.trophies.map((trophy) => ({
      key: `${title.npCommunicationId}-${trophy.groupId}-${trophy.id}`,
      trophy,
    })),
  );
  const groups =
    titles?.flatMap((title) =>
      title.groups.length > 1
        ? title.groups.map((group) => ({
            key: `${title.npCommunicationId}-${group.id}`,
            group,
          }))
        : [],
    ) ?? [];
  const listRef = useRowSnap(trophies?.[0]?.key);
  const empty = (
    <div className="text-sm leading-snug text-muted-foreground">
      {name} 还没有奖杯记录
    </div>
  );

  // 目录还没到，才轮到摘要和加载态说话
  if (!titles) {
    // 只有摘要确实说过「这张卡没有奖杯组」时，才敢不等目录就下结论
    if (knownEmpty) return empty;
    if (loading) {
      return (
        <div
          className="flex items-center text-sm text-muted-foreground"
          style={{ height: MIN_ROW_HEIGHT_PX * VISIBLE_ROWS }}
        >
          正在读取奖杯
        </div>
      );
    }
    if (error) {
      return <div className="text-sm leading-snug text-muted-foreground">{error}</div>;
    }
    return empty;
  }
  // 目录到了就以目录为准：摘要那份 digest 漏了这款也不算数
  if (!trophies?.length) return empty;

  return (
    <div {...(groups.length ? { "data-trophy-groups-wanted": "" } : {})}>
      <GroupSlot groups={groups} resetKey={trophies[0]?.key} />
      <TrophyViewport listRef={listRef}>
        {trophies.map((row) => (
          <div key={row.key} className="min-w-0">
            <TrophyRow trophy={row.trophy} />
          </div>
        ))}
      </TrophyViewport>
    </div>
  );
}
