"use client";

import NumberFlow, { NumberFlowGroup } from "@number-flow/react";
import { Sparkle } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";

import { Card } from "@/components/ui/card";
import { HomePodMiniIcon, MacBookProIcon } from "@/components/ui/device-icons";
import { HeroMotionArtwork } from "@/components/live/hero-motion-artwork";
import { ListenAlongButton } from "@/components/live/listen-along-button";
import { useListenAlong } from "@/hooks/use-listen-along";
import { useLiveEvents } from "@/hooks/use-live-events";
import { useMotionArtwork } from "@/hooks/use-motion-artwork";
import { useMountedAt } from "@/hooks/use-mounted-at";
import { useExpiryRefetch, useStatus } from "@/hooks/use-status";
import { stableKeys } from "@/lib/keys";
import {
  HERO_VARIANTS,
  LIST_ITEM_VARIANTS,
  LIST_TRANSITION,
  STATIC_TRANSITION,
  STATIC_VARIANTS,
} from "@/lib/motion";
import { LISTENING_PATH, NOW_LISTENING_PATH } from "@/lib/paths";
import { trackPositionMs } from "@/lib/track-position";
import type {
  ListeningItem,
  ListeningPayload,
  LocalNowPlaying,
  NowListeningPayload,
  StatusResponse,
} from "@/lib/types";
import { appleArtwork, ARTWORK_SCALE, needsOptimizing } from "@/lib/apple-artwork";
import { cn } from "@/lib/utils";

/**
 * 列表变了会把完整数据推过来，轮询只兜「推送整体停用」这一种情况，所以给得很松。
 * 从前是 30 秒，那时列表要靠轮询才会翻 —— 服务端还得现打 Apple 的目录接口。
 */
const REFRESH_MS = 10 * 60_000;
/** 实时播放由推送送来，轮询只是兜底 */
const MUSIC_REFRESH_MS = 60_000;

/**
 * 视口里显示几行。行高不写死：列表填满卡片剩下的空间，每行取容器的 1/N
 * （grid-auto-rows: calc(100% / N)），所以永远是整数行、底部也不会留空。
 * 这件事 CSS 自己就能算，不需要 JS 去量。
 */
const VISIBLE_ROWS = 4;
/** 单行的最小高度：44px 封面 + 上下留白，比这个再矮就挤了 */
const MIN_ROW_HEIGHT_PX = 56;

/**
 * 专辑 / 歌单总时长。超过一小时给 h:mm:ss，否则 m:ss。
 *
 * 不用上面那个 Clock：那个是给会走的进度用的，滚动数字有意义；总时长是死的，
 * 而且 hero 一换就整个重挂、NumberFlow 拿不到上一个值，本来也滚不起来。
 * 歌单动辄一两个小时，75:09 这种写法读起来别扭。
 */
function formatDuration(milliseconds: number) {
  const total = Math.max(0, Math.round(milliseconds / 1000));
  const seconds = String(total % 60).padStart(2, "0");
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

/**
 * 把封面取色拼成那条彩虹的渐变。
 *
 * Apple 给的五个色不能直接用：textColor 是设计来叠在 bgColor 上的，浅色封面
 * 配近黑、深色封面配浅色，原样画出来一半的专辑会得到一条几乎全黑的线。
 * `oklch(from …)` 只留色相、把亮度和彩度按住在可见区间，这样每张封面都出一条
 * 看得见、又确实是它自己颜色的带子。换算交给 CSS，不在 JS 里写颜色数学。
 *
 * 首尾补回第一个色，配 background-size: 200% 才能无缝循环。取不到调色板就返回
 * undefined，让 .rainbow-bar 自带的那条通用彩虹兜底。
 */
function paletteGradient(palette: string[]): string | undefined {
  if (palette.length < 2) return undefined;
  const stops = [...palette, palette[0]]
    .map((color) => (color.startsWith("#") ? color : `#${color}`))
    .map((color) => `oklch(from ${color} 0.74 max(c, 0.09) h)`)
    .join(", ");
  return `linear-gradient(90deg, ${stops})`;
}

/**
 * 一条跟着封面配色走的带子，两层叠着交叉淡入。
 *
 * 动态封面的取色比静态封面晚到几百毫秒，而 `background-image` 不参与过渡 ——
 * 直接换那一下颜色是「啪」地跳过去的。所以底层始终画静态封面那套
 * （没有调色板就退回绿色或暂停时的灰色），动态那套取到了再淡进来。
 *
 * 上层从一开始就挂着、只是 opacity 0：两层的 rainbow-drift 得同时起步才同相。
 * 等要用时才挂载的话新层动画从头跑，和底层错开，交叉淡入的中途会看出两道颜色
 * 在互相错动。
 */
function PaletteBar({
  base,
  motion: motionGradient,
  idleClassName,
  className,
  style,
}: {
  base?: string;
  motion?: string;
  idleClassName?: string;
  className?: string;
  style?: CSSProperties;
}) {
  /**
   * 暂停时调用方会把 motion 清掉。上层始终挂着 .rainbow-bar，内联背景一摘，
   * CSS 那条通用彩虹就会露出来，再花 700ms 淡成灰 —— 看起来像跳成另一种彩条。
   *
   * callback ref 在 commit 阶段才写 DOM：有新颜色就替换，motion 清空时什么都
   * 不做，让节点保留上一套背景并同时把 opacity 切到 0。这样行为和原来一致，
   * 又不会在并发渲染期间读写 ref。
   */
  const rememberMotionGradient = useCallback(
    (node: HTMLDivElement | null) => {
      if (node && motionGradient) node.style.backgroundImage = motionGradient;
    },
    [motionGradient],
  );

  return (
    <div className={cn("relative", className)} style={style} aria-hidden>
      <div
        className={cn("absolute inset-0", base ? "rainbow-bar" : idleClassName)}
        style={{ backgroundImage: base }}
      />
      {/* rainbow-bar 不能跟着 opacity 一起切：CSS 动画从元素命中规则那刻起算，
          等淡入时才加就等于让上层的 drift 从头跑，和底层错开相位。 */}
      <div
        ref={rememberMotionGradient}
        className={cn(
          "rainbow-bar absolute inset-0 transition-opacity ease-out",
          motionGradient ? "opacity-100 duration-700" : "opacity-0 duration-0",
        )}
      />
    </div>
  );
}

/**
 * 三根竖条。推断为正在播时跳动，否则静止成一个普通的音乐小图标。
 *
 * 动画相位挂在墙上时钟，不挂在挂载时刻。换歌时整个 hero 会重新挂载，CSS 动画
 * 默认从头开始，三根条齐刷刷跳回起点 —— 从前 mode="wait" 中间空一拍把这一下
 * 盖住了，改成交叉淡入后新旧同时可见，顿挫就露出来了。
 *
 * 负的 animation-delay 表示「已经播过这么久」：取 now % period，任何时刻新挂载
 * 的实例都落在和旧实例相同的相位上，接得上。重渲染时重算也是幂等的 —— 算出来
 * 的还是当前相位，不会自己把自己顿一下。
 *
 * 不用担心和服务端对不上：相位是在 ref 回调（提交阶段）里写进 DOM 的，
 * 服务端根本不跑那一段，首屏 HTML 里这三根条不带 animation-delay。
 */
const BAR_PERIODS = [0.9, 1.15, 1.4];

/**
 * 三种状态，不是两种。
 *
 * - playing 在跳
 * - paused  就地冻住。keyframes 动的是 transform: scaleY，所以只要保住 h-full
 *   这个基准盒、把 animation-play-state 切成 paused，浏览器就停在当前那一帧上。
 *   从前这一档和 idle 合并了，一按暂停三根条会弹回固定形状 —— 明明只是暂停，
 *   看起来却像换了个东西。
 * - idle    历史条目，从来没跳过，没有「当前姿态」可冻，用固定形状
 */
type BarsState = "playing" | "paused" | "idle";

function Bars({ state }: { state: BarsState }) {
  const idleHeights = ["h-2", "h-3", "h-1.5"];
  const animated = state !== "idle";

  /**
   * 在 ref 回调里对相位，不在渲染里。
   *
   * Date.now 是不纯的，渲染期调用会被 react-hooks 拦下（结果也确实不稳定）。
   * ref 回调跑在 commit 阶段、绘制之前，既保住渲染纯粹，也不会先闪一帧相位 0。
   *
   * paused 也要对：直接以暂停态挂载时（刷新页面时曲子正暂停着），不对的话三根
   * 条会齐刷刷停在 scaleY(0.3)，像根本没播过。playing→paused 那次重跑是幂等的，
   * 算出来还是当前相位，冻住的姿态不会被挪动。
   */
  const alignPhase = useCallback(
    (node: HTMLSpanElement | null) => {
      if (!node || !animated) return;
      const seconds = Date.now() / 1000;
      [...node.children].forEach((child, i) => {
        const period = BAR_PERIODS[i];
        // 错开的起点保留原来的观感；周期本来就各不相同，跳起来不会齐步走
        (child as HTMLElement).style.animationDelay =
          `${(-((seconds % period) + i * 0.15)).toFixed(3)}s`;
      });
    },
    [animated],
  );

  return (
    <span className="flex h-3 items-end gap-0.5" aria-hidden ref={alignPhase}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn(
            "w-0.5 origin-bottom",
            state === "idle"
              ? `bg-muted-foreground ${idleHeights[i]}`
              : state === "playing"
                ? "h-full bg-live"
                : "h-full bg-muted-foreground",
          )}
          style={
            animated
              ? {
                  animation: `equalizer ${BAR_PERIODS[i]}s ease-in-out infinite`,
                  // 值本身不变，React 只会补上这一条，动画不会被重置
                  animationPlayState: state === "paused" ? "paused" : "running",
                }
              : undefined
          }
        />
      ))}
    </span>
  );
}

/**
 * 时钟的一格，秒进位时和充电头的瓦数一样滚动。
 *
 * 分秒拆成两个 NumberFlow 而不是把 "2:19" 当一个数字：冒号不是千分位那类
 * 分隔符，Intl 也没有 mm:ss 的格式，只能自己拼。外面套 NumberFlowGroup 才能
 * 让 59→00 那一下两格同时翻，否则各滚各的、时间差看得出来。
 *
 * 秒补零交给 minimumIntegerDigits，不用 padStart —— 字符串补出来的零是静态
 * 文本，滚动时那一位不会动。
 */
function Clock({ milliseconds }: { milliseconds: number }) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  return (
    <>
      <NumberFlow value={Math.floor(seconds / 60)} locales="en-US" />
      <span>:</span>
      <NumberFlow
        value={seconds % 60}
        locales="en-US"
        format={{ minimumIntegerDigits: 2 }}
      />
    </>
  );
}

/**
 * 本机曲目的副标题行 + 进度条。
 *
 * 挤进 hero 而不撑高它：hero 的高度由 80px 封面定死，文字列实测只用掉 67px，
 * 剩 13px。时间放进副标题行右侧（那一行本来就存在，label-mono 是 11px/行高 1，
 * 比 text-sm 的 20px 行盒矮，只占宽度不占高度），进度条另起一行占 3+6=9px，
 * 合计 76px，仍在 80px 之内。
 *
 * 秒级计时器留在这个组件里，不放到 ListeningCard —— 否则下面那个带布局动画的
 * 列表会跟着每秒重渲染一次。
 */
function HeroProgress({
  track,
  subtitle,
  palette,
  motionGradient,
}: {
  track: LocalNowPlaying;
  subtitle: string;
  palette?: string[];
  motionGradient?: string;
}) {
  const playing = track.state === "playing";
  /**
   * 首帧 now 是 0（见 useMountedAt），服务端只画锚点、进度不往前推 —— 服务端算
   * 的偏移和 hydrate 那一刻算的必然差着毫秒，时间文本和进度条宽度都会对不上。
   * 往前推留给客户端，和「最近在看」那排卡片的进度条同一个思路。
   *
   * 不用为首帧另开分支：下面 max(0, 0 - observedAt) 本来就是 0。
   */
  const mountedAt = useMountedAt();
  const [ticked, setTicked] = useState(0);
  const now = ticked || mountedAt;

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setTicked(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [playing]);

  // 推算规则和「一起听」共用一份，见 lib/track-position —— 两边各写一遍的话，
  // 画在进度条上的和访客耳朵里放的会慢慢错开，还看不出是谁错了
  const position = trackPositionMs(track, now);
  const percent = track.durationMs ? (position / track.durationMs) * 100 : 0;
  const gradient = palette && palette.length >= 2 ? paletteGradient(palette) : undefined;

  return (
    <>
      <div className="mt-px flex items-baseline gap-2 text-sm text-muted-foreground">
        <span className="min-w-0 flex-1 truncate" title={subtitle}>
          {subtitle}
        </span>
        <NumberFlowGroup>
          <span className="label-mono shrink-0 tabular-nums">
            <Clock milliseconds={position} />
            <span> / </span>
            <Clock milliseconds={track.durationMs} />
          </span>
        </NumberFlowGroup>
      </div>
      <div className="mt-1.5 h-0.75 overflow-hidden bg-muted">
        {/* 暂停时不分层：一条静的灰带子，没有颜色好过渡 */}
        <PaletteBar
          className="h-full transition-[width] duration-700 ease-linear"
          base={playing ? gradient : undefined}
          motion={playing ? motionGradient : undefined}
          idleClassName={playing ? "bg-live" : "bg-muted-foreground"}
          style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
        />
      </div>
    </>
  );
}

function TrackRow({ track }: { track: ListeningItem }) {
  const content = (
    <>
      <div className="relative size-11 shrink-0 overflow-hidden rounded-sm border border-line bg-muted">
        {track.artwork && (
          <Image
            src={appleArtwork(track.artwork, 44 * ARTWORK_SCALE)!}
            alt=""
            fill
            sizes="44px"
            className="object-cover"
            unoptimized={!needsOptimizing(track.artwork)}
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{track.title}</div>
        <div className="truncate text-xs text-muted-foreground">
          {track.artist}
        </div>
      </div>
    </>
  );

  // 高度和吸附交给外层的 motion 包装，这里只管行内布局
  const className =
    "flex h-full items-center gap-2.5 rounded-md px-2 transition-colors hover:bg-surface-hover";

  return track.link ? (
    <a
      href={track.link}
      target="_blank"
      rel="noreferrer noopener"
      className={className}
    >
      {content}
    </a>
  ) : (
    <div className={className}>{content}</div>
  );
}

function dedupeListeningItems(items: ListeningItem[], currentId: string | null) {
  const seen = new Set<string>();

  return items.filter((item) => {
    if (currentId && item.id === currentId) return false;
    if (!item.id) return true;
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

/** 占位行。高度由 grid 轨道给，和 TrackRow 一样，加载完不会跳 */
function SkeletonRow() {
  return (
    <div className="flex h-full items-center gap-2.5 px-2">
      <div className="size-11 shrink-0 animate-pulse rounded-sm bg-muted" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="h-3 w-2/5 animate-pulse rounded bg-muted" />
        <div className="h-2.5 w-1/4 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}

// 服务端没有 layout 阶段，useLayoutEffect 会告警，这里按环境切换
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** 用户停止滚动后多久开始对齐 */
const SETTLE_DELAY_MS = 110;
/** 数据变化后这段时间内不做对齐，等重排动画落定 */
const SUSPEND_AFTER_CHANGE_MS = 500;

/**
 * 保证列表永远停在整行上，同时不和重排动画打架。
 *
 * 没有用 CSS 的 scroll-snap：它会在数据变化时重新计算吸附目标，而 popLayout
 * 会把离场元素改成绝对定位、容器高度剧变，导致吸附算飞 —— 实测 scrollTop
 * 会被弹到 48 甚至 192。「动画期间临时关掉吸附」也不行，装回去的那一刻
 * 动画还没落定，照样被吸走。
 *
 * 所以自己做：只在「用户滚动停下来之后」对齐到最近的整行，
 * 并且在数据变化后的动画窗口内跳过。浏览器不再有插手的机会。
 */
function useRowSnap(topKey: string | undefined, wide: boolean) {
  const node = useRef<HTMLDivElement | null>(null);
  const previous = useRef(topKey);
  const suspendUntil = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 顶部换人：拉回顶端，并在动画期间挂起对齐
  useIsomorphicLayoutEffect(() => {
    if (previous.current === topKey) return;
    previous.current = topKey;
    suspendUntil.current = Date.now() + SUSPEND_AFTER_CHANGE_MS;

    const el = node.current;
    if (!el || el.scrollTop === 0) return;
    // 临时关掉 scroll-smooth，否则会看到「先跳一下再滑回来」
    const saved = el.style.scrollBehavior;
    el.style.scrollBehavior = "auto";
    el.scrollTop = 0;
    el.style.scrollBehavior = saved;
  }, [topKey]);

  // 展开为两列时只展示最前面的八项，必须先回到 scrollTop 0；否则用户之前
  // 在单列里滚过以后，overflow:hidden 会把列表定格在中间一段。
  useIsomorphicLayoutEffect(() => {
    if (!wide || !node.current) return;
    node.current.scrollTop = 0;
  }, [wide]);

  /**
   * 用 ref 回调挂监听：节点一出现就绑，卸载时清掉。
   * （列表视口现在始终挂着，不过 ref 回调对条件渲染同样稳妥。）
   */
  return useCallback((el: HTMLDivElement | null) => {
    node.current = el;
    if (!el) return;

    const onScroll = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (Date.now() < suspendUntil.current) return;
        // 行高就是容器的 1/N，跟着容器走，不用另外记
        const rowHeight = el.clientHeight / VISIBLE_ROWS;
        const target = Math.round(el.scrollTop / rowHeight) * rowHeight;
        // 已经对齐就别再滚，否则自己触发的 scroll 会来回抖
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

/** 移动端遮罩挡住封面以右，点击仍要落到下面的链接上。 */
function passClickThrough(event: MouseEvent<HTMLDivElement>) {
  const overlay = event.currentTarget;
  overlay.style.pointerEvents = "none";
  const under = document.elementFromPoint(event.clientX, event.clientY);
  overlay.style.pointerEvents = "";
  const link = under?.closest("a");
  if (link instanceof HTMLAnchorElement) link.click();
}

/** 有链接就整块可点，没有就退化成普通容器 */
function HeroWrapper({
  link,
  children,
}: {
  link: string | null;
  children: ReactNode;
}) {
  // h-full：外层把 hero 钉在 h-20，这里填满；高度锁定靠绝对定位叠层，不靠 overflow
  const className = "group flex h-full gap-3 rounded-md";
  return link ? (
    <a
      href={link}
      target="_blank"
      rel="noreferrer noopener"
      className={className}
    >
      {children}
    </a>
  ) : (
    <div className={className}>{children}</div>
  );
}

/** hero 那一格的统一形状：本机曲目和 Apple Music 条目共用同一套渲染 */
type Hero = {
  key: string;
  artwork: string | null;
  title: string;
  subtitle: string;
  link: string | null;
  label: string;
  playing: boolean;
  /** 封面取色。实时曲目没有自己的，能对上最近播放里同一张就借用。 */
  palette: string[];
  /** 整张专辑 / 歌单的总时长。实时那一支不用（它显示的是曲目进度） */
  durationMs: number | null;
  /**
   * 本机 Music.app 正在放的那首（而不是 Apple Music 的历史记录）。
   * 有值就说明能拿到播放进度，副标题行会换成带进度条的版本。
   */
  track: LocalNowPlaying | null;
  /**
   * 「正在播放」来自观测最近播放列表的推断，不是 Mac / HomePod 实况。
   * 和 track 互斥：有实况就用设备标签，推断才打 inferred。
   */
  inferred: boolean;
};

export function ListeningCard({
  fallback,
  nowFallback,
  className,
  wide = false,
}: {
  fallback: StatusResponse<ListeningPayload>;
  nowFallback: StatusResponse<NowListeningPayload>;
  className?: string;
  /** 充电卡隐藏、桌面端横跨两列时，列表切成 4 × 2 的无滚动布局。 */
  wide?: boolean;
}) {
  const { data, error, isLoading } = useStatus<ListeningPayload>(LISTENING_PATH, REFRESH_MS, {
    fallback,
  });
  useLiveEvents();
  const { data: live } = useStatus<NowListeningPayload>(NOW_LISTENING_PATH, MUSIC_REFRESH_MS, {
    fallback: nowFallback,
  });
  /**
   * 暂停宽限期到点时再问一次。
   *
   * 那一刻服务端会把来源让给下一个实时源，但它不对应任何一次上报，没有推送
   * 会到 —— 从前是服务端挂 setTimeout 补一条，serverless 上不成立。剩多少毫秒
   * 由服务端算好放在 expiresInMs 里，这边只管排队，不重算规则、也不拿本机时钟
   * 去减设备时钟。
   */
  useExpiryRefetch(NOW_LISTENING_PATH, live?.expiresInMs);

  const reduced = useReducedMotion();

  // MacBook 与 HomePod 都没有可用状态时才退回最近播放列表。
  const localMusic = live?.idle ? null : live?.music ?? null;
  const localTrack =
    localMusic?.title && localMusic.state !== "stopped" ? localMusic : null;
  // 来源仍然只由服务端选，前端不重算宽限期，只负责在它到期时再问一次
  // （见上面的 nowListeningInterval），所以这里渲染的始终是服务端的结论。
  const localActive = Boolean(localTrack);

  /**
   * 跟着这首一起听。访客用自己的订阅授权，音频不经过站点，见 use-listen-along。
   *
   * 右上角那格平时写着「Apple Music」（说明这张卡的来源），有东西可跟听时换成
   * 按钮 —— 那一刻「你也能听」比「这是 Apple Music」更值得占这个位置。
   * 已经开始跟听之后一直留着，否则主人一停，访客就没地方把它关掉了。
   */
  const listenAlong = useListenAlong({
    track: localTrack,
    songId: live?.songId ?? null,
    upcomingSongIds: live?.upcomingSongIds ?? [],
  });
  const showListenAlong =
    listenAlong.status !== "unavailable" &&
    (Boolean(localTrack && live?.songId) || listenAlong.status !== "idle");

  const [latest, ...tail] = data?.items ?? [];

  /**
   * 记住实时源刚才解析到的那张专辑 ID。
   *
   * 宽限期一过，服务端会把 music 和 id 一并清空，客户端从此分不清「Mac 刚暂停」
   * 和「Mac 根本没开过」—— 而这两种情况下该不该信推断，答案正好相反。
   */
  // 渲染期直接调整，不放 useEffect —— 那样要多渲染一轮，而且 set-state-in-effect
  // 本来就是反模式。React 对「props 变了顺手修 state」推荐的就是这个写法。
  const [lastLiveId, setLastLiveId] = useState<string | null>(null);
  if (live?.id && live.id !== lastLiveId) setLastLiveId(live.id);

  /**
   * 推断出来的「正在听」，且确实指向排在最前的这一项。
   *
   * 但如果排在最前的就是实时源刚才在放的那张，就不信这个推断 —— 我们比它知道得
   * 多：设备亲口说了暂停/停止，而推断只会按「这个容器什么时候排到第一」加曲目
   * 总时长去算，于是刚按下暂停、宽限期一过，卡片反而从「播放暂停」翻成绿色的
   * 「正在播放」。等别的条目顶上来，这层压制自然就解除了。
   */
  const backFromLive = lastLiveId != null && lastLiveId === latest?.id;
  const playing =
    !backFromLive && Boolean(data?.nowPlaying && data.nowPlaying.itemId === latest?.id);

  const hero: Hero | null = localActive
    ? {
        key: `${localTrack!.source}:${localTrack!.trackId ?? localTrack!.title}`,
        artwork: localTrack!.artworkUrl,
        title: localTrack!.title ?? "",
        // 只放艺人：标题已经是曲名，专辑名多半是「曲名 - Single」这种同义重复
        subtitle: localTrack!.artist ?? "",
        // 设备给不出可分享的地址，服务端拿曲名 + 艺人去目录里解析出来的
        link: live?.link ?? null,
        label:
          localTrack!.state === "playing"
            ? localTrack!.repeatOne
              ? "单曲循环"
              : "正在播放"
            : "播放暂停",
        playing: localTrack!.state === "playing",
        palette:
          data?.items.find((item) => item.id === live?.id)?.palette ?? [],
        durationMs: null,
        track: localTrack,
        inferred: false,
      }
    : latest
      ? {
          key: latest.id,
          artwork: latest.artwork,
          title: latest.title,
          subtitle: latest.artist,
          link: latest.link,
          label: playing ? "正在播放" : "最近听过",
          playing,
          palette: latest.palette,
          durationMs: latest.durationMs,
          track: null,
          inferred: playing,
        }
      : null;

  // 本机那首顶替 hero 时，Apple Music 原来的第一首下沉回列表；
  // 但和实时资源 ID 相同的条目不再重复展示。
  const rest = dedupeListeningItems(
    localActive ? (data?.items ?? []) : tail,
    localActive ? (live?.id ?? null) : null,
  );
  // 对重排稳定的 key，否则顶部插入新条目时会被当成整批换新
  const restKeys = stableKeys(rest.map((item) => item.id));
  const listRef = useRowSnap(restKeys[0], wide);

  const { data: motionData } = useMotionArtwork(hero?.link);
  // 动态封面自带一套取色，比静态封面那套晚到；交给 PaletteBar 淡进来，别直接顶掉
  const motionGradient =
    motionData?.colors && motionData.colors.length >= 2
      ? paletteGradient(motionData.colors)
      : undefined;

  return (
    <Card
      label="Recently Played"
      action={showListenAlong ? <ListenAlongButton listen={listenAlong} /> : "Apple Music"}
      className={cn("h-full min-h-93.5", className)}
    >
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-3">
        {/* 最近的一项放大展示。整块都是链接 —— 点封面也能跳转。
            换专辑/歌单时新旧叠着交叉淡入，见 HERO_VARIANTS。

            外层 h-20 钉死高度：封面是 w-20 方块，整块 hero 设计上就是 80px。
            子项一律 absolute inset-0 —— 新旧叠在同一个槽里淡入淡出，不挤文档流，
            也就不需要 popLayout（它和 overflow / 固定高度容器打架，动画会被吃掉）。

            首屏「读取中」不进 AnimatePresence：占位态和 hero 根本不是同一个东西，
            让它们互相淡入淡出没有意义，只会在数据到达时糊一下。等有数据再挂载，
            initial={false} 就会直接跳过入场动画，首屏不播这一下。 */}
        <div className="relative h-20 shrink-0">
          {!hero ? (
            <HeroWrapper link={null}>
              <div className="relative aspect-square w-20 shrink-0 overflow-hidden rounded-md border border-line bg-muted" />
              <div className="flex min-w-0 flex-1 flex-col justify-center">
                <div className="text-sm text-muted-foreground">
                  {isLoading
                    ? "读取中…"
                    : error
                      ? "Apple Music 未连接"
                      : "最近没有播放记录"}
                </div>
              </div>
            </HeroWrapper>
          ) : (
            <AnimatePresence initial={false}>
              <motion.div
                key={hero.key}
                className="absolute inset-0"
                variants={reduced ? STATIC_VARIANTS : HERO_VARIANTS}
                initial="initial"
                animate="animate"
                exit="exit"
                // 非对称时长写在 variant 里，这里传统一的 transition 会把它抹平
                transition={reduced ? STATIC_TRANSITION : undefined}
              >
                <HeroWrapper link={hero.link}>
                  <HeroMotionArtwork
                    artwork={hero.artwork}
                    title={hero.title}
                    videoUrl={motionData?.hasMotion ? motionData.videoUrl : null}
                    reduced={Boolean(reduced)}
                  />

                  {/*
                不用统一的 gap：三行的行内 leading 不一样（标签行盒高贴合文字，
                标题和副标题各自还有 3px 内部余白），统一 gap 会让视觉间隙一宽一窄。
                这里按实测的 leading 差额补偿，让两处视觉间隙都落在 8px 左右。
              */}
                  <div className="flex min-w-0 flex-1 flex-col justify-center overflow-hidden">
                    {/* 图标在左、文字在右，和 CHARGER / C1 那些标签行一致：
                        对齐的是图标的左边界，标签文字本身缩进。

                        min-h-5 锁死行高：设备标签只在实时曲目那一版出现，它自带
                        边框和内距（20px），比光秃秃的 label-mono（约 12px）高一截。
                        不锁的话两版 hero 高度不同，外层 justify-center 会重新居中，
                        切换时整列上下挪一下 —— 交叉淡入让新旧同时可见，那一挪就成了
                        肉眼可见的滑动。 */}
                    <div className="flex min-h-5 min-w-0 items-center gap-1.5">
                      {/* 有 track 就是实时源：没在放就是暂停，冻住而不是弹回固定形状 */}
                      <Bars
                        state={
                          hero.playing ? "playing" : hero.track ? "paused" : "idle"
                        }
                      />
                      <span
                        className={cn(
                          "label-mono shrink-0",
                          hero.playing ? "text-live" : "text-muted-foreground",
                        )}
                      >
                        {hero.label}
                      </span>
                      {/* 实时曲目来自 MacBook Music.app 或 HomePod，不是历史记录。 */}
                      {hero.track && (
                        <span className="ml-0.5 inline-flex min-w-0 items-center gap-1 rounded-sm border border-line px-1.5 py-px text-[10px] leading-4 text-muted-foreground">
                          {hero.track.source === "homepod" ? (
                            <HomePodMiniIcon className="size-3 shrink-0" aria-hidden />
                          ) : (
                            <MacBookProIcon className="size-3 shrink-0" aria-hidden />
                          )}
                          <span className="truncate">
                            {hero.track.source === "homepod" ? "HomePod mini" : "MacBook Pro"}
                          </span>
                        </span>
                      )}
                      {/* 没有实况、只靠最近播放列表推出来的「正在播放」。 */}
                      {hero.inferred && (
                        <span
                          className="ml-0.5 inline-flex shrink-0 items-center gap-1 rounded-sm border border-line px-1.5 py-px text-[10px] leading-4 text-muted-foreground"
                          title="由 Apple Music 最近播放列表推断，不是设备实况"
                        >
                          <Sparkle className="size-3 shrink-0" aria-hidden />
                          <span className="truncate">inferred</span>
                        </span>
                      )}
                    </div>
                    <div
                      className={cn(
                        "mt-1 truncate font-medium leading-snug",
                        hero.link && "group-hover:underline",
                      )}
                      title={hero.title}
                    >
                      {hero.title}
                    </div>
                    {hero.track ? (
                      <HeroProgress
                        track={hero.track}
                        subtitle={hero.subtitle}
                        palette={hero.palette}
                        motionGradient={motionGradient}
                      />
                    ) : (
                      <>
                        {/* 和实时那版的副标题行同构：左边艺人，右边时间。那边是
                            「已播 / 总长」，这边没有进度，只放总长。 */}
                        <div className="mt-px flex items-baseline gap-2 text-sm text-muted-foreground">
                          <span className="min-w-0 flex-1 truncate" title={hero.subtitle}>
                            {hero.subtitle}
                          </span>
                          {hero.durationMs != null && (
                            <span className="label-mono shrink-0 tabular-nums">
                              {formatDuration(hero.durationMs)}
                            </span>
                          )}
                        </div>
                        {/* 尺寸和 HeroProgress 那根进度条一模一样。历史条目没有进度可
                            显示，但两版 hero 的高度必须一致，理由同上面那段 —— 与其留
                            一道不可见的空档，不如填满，见 globals.css 的 .rainbow-bar。 */}
                        <PaletteBar
                          className="mt-1.5 h-0.75"
                          base={paletteGradient(hero.palette)}
                          motion={motionGradient}
                          // 取不到调色板时露出 .rainbow-bar 自带的那条通用彩虹
                          idleClassName="rainbow-bar"
                        />
                      </>
                    )}
                  </div>
                </HeroWrapper>
              </motion.div>
            </AnimatePresence>
          )}
        </div>

        {/*
          再往前的几项。上游最多给 10 条，全部列出，放不下就滚动。

          视口必须始终挂着：列表为空时 isLoading 也是 false、rest 也是空的 ——
          以前用 (isLoading || rest.length) 包一层，那种情况下首屏 HTML 就把
          这块省掉了，客户端补上数据再插进来，整行一起被撑高。

          高度用 minHeight 而不是写死：充电头那边 sparkline 钉在 h-32，
          整行由它定高；这边列表吃掉剩余，行高由 grid-auto-rows 平摊。
        */}
        {/* 边框和内边距放在外层，滚动容器本身不带 padding ——
            否则吸附位会被 padding 顶偏，还得再补 scroll-padding
            min-h-0 不能少：flex 子项默认 min-height:auto，会被内容撑破而不是滚动 */}
        <div className="mt-3 flex min-h-0 flex-1 flex-col border-t border-line pt-2">
          {/*
            滚动容器绝对定位，是为了让它对「这张卡有多高」完全没有发言权。
            grid 行按 max-content 定高：让它参与的话，10 条 × 行高会被当成
            卡片的固有高度，整个「此刻」区块被撑到近两倍（实测 364 → 588）。
            绝对定位的子元素不参与固有尺寸计算；min-height 是这块唯一的话语权。
          */}
          <div
            className="relative min-h-0 flex-1"
            style={{ minHeight: `${MIN_ROW_HEIGHT_PX * VISIBLE_ROWS}px` }}
          >
            <div
              ref={listRef}
              className={cn(
                // 每行高 = 容器的 1/N。容器高度是确定的（absolute inset-0），
                // 百分比轨道就有得算 —— 于是「整数行」「填满」两件事同时由
                // CSS 保证，不需要 ResizeObserver 去量、也没有写死的行高。
                "absolute inset-0 grid overflow-y-auto",
                "recent-tracks",
                wide && "is-wide",
                // 这里刻意不做 scroll-snap。它会和 framer 的 layout 动画打架：
                // popLayout 把离场元素改成绝对定位，容器高度剧变，吸附目标算飞，
                // 实测新条目进来时 scrollTop 会被弹到 48 甚至 192 再慢慢滑回。
                // 整数行是靠「容器高度正好等于行高整数倍」保证的，不需要吸附。
                "scroll-smooth overscroll-y-contain",
                // 关掉滚动锚定：新条目插到顶部时，浏览器会为了「保持视觉位置不动」
                // 自动把 scrollTop 加一行，结果第一行被顶出可视区，得手动滑回去
                "[overflow-anchor:none]",
                "scrollbar-none [&::-webkit-scrollbar]:hidden",
              )}
              // 写成内联而不是 Tailwind 的 arbitrary value：后者必须是字面量，
              // 行数就会在两处各写一遍
              style={{ gridAutoRows: `calc(100% / ${VISIBLE_ROWS})` }}
            >
              {rest.length > 0 ? (
                // popLayout 让离场的行脱离布局流，剩下的能同时补位而不是等它消失
                <AnimatePresence initial={false} mode="popLayout">
                  {rest.map((item, index) => (
                    <motion.div
                      key={restKeys[index]}
                      layout={!reduced}
                      variants={reduced ? STATIC_VARIANTS : LIST_ITEM_VARIANTS}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                      transition={reduced ? STATIC_TRANSITION : LIST_TRANSITION}
                      // 高度由 grid 轨道给；min-w-0 保住行内的 truncate
                      className="min-w-0"
                    >
                      <TrackRow track={item} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              ) : isLoading ? (
                Array.from({ length: VISIBLE_ROWS }, (_, i) => (
                  <SkeletonRow key={i} />
                ))
              ) : null}
            </div>
            {/*
              歌名那一侧盖一层，把滑动交给页面。Safari 上 overflow 容器一旦
              pointer-events:none，连点到 pointer-events:auto 的子项也划不动，
              所以滚动容器本身必须能接收触摸，改用遮罩挡住封面以右。
            */}
            <div
              className="recent-tracks-page-pan"
              aria-hidden
              onClick={passClickThrough}
            />
          </div>
        </div>
      </div>
    </Card>
  );
}
