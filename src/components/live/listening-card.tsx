"use client";

import NumberFlow, { NumberFlowGroup } from "@number-flow/react";
import { Laptop, Speaker } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Card } from "@/components/ui/card";
import { useLiveStream } from "@/hooks/use-live-stream";
import { useStatus } from "@/hooks/use-status";
import { stableKeys } from "@/lib/keys";
import {
  HERO_VARIANTS,
  LIST_ITEM_VARIANTS,
  LIST_TRANSITION,
  STATIC_TRANSITION,
  STATIC_VARIANTS,
} from "@/lib/motion";
import { LISTENING_PATH, MUSIC_PATH } from "@/lib/paths";
import type {
  ListeningItem,
  ListeningPayload,
  LocalNowPlaying,
  MusicPayload,
} from "@/lib/types";
import { appleArtwork, ARTWORK_SCALE } from "@/lib/apple-artwork";
import { cn } from "@/lib/utils";

/** 与服务端 30s 列表缓存对齐 */
const REFRESH_MS = 30_000;
/** 实时播放：推送断了才靠轮询顶着 */
const MUSIC_REFRESH_MS = 3_000;
/** 推送正常时轮询只是兜底 */
const MUSIC_PUSHED_REFRESH_MS = 30_000;

/**
 * 视口里显示几行。行高不写死：列表填满卡片剩下的空间，每行取容器的 1/N
 * （grid-auto-rows: calc(100% / N)），所以永远是整数行、底部也不会留空。
 * 这件事 CSS 自己就能算，不需要 JS 去量。
 */
const VISIBLE_ROWS = 4;
/** 单行的最小高度：36px 封面 + 上下留白，比这个再矮就挤了 */
const MIN_ROW_HEIGHT_PX = 48;

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
 * 不用担心和服务端对不上：hero 要等 SWR 拿到数据才存在，服务端那一遍走的是
 * 占位分支，这段根本不参与首屏 HTML。
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
            "w-0.5 origin-bottom rounded-full",
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
}: {
  track: LocalNowPlaying;
  subtitle: string;
}) {
  const playing = track.state === "playing";
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [playing]);

  // 上报器只在换歌和播放状态变化时推锚点，播放中的进度由前端按 observedAt 推算
  const drift = playing ? Math.max(0, now - track.observedAt) : 0;
  const elapsed = track.positionMs + drift;
  // 单曲循环时上游可能一直不推新锚点（曲目没变、状态没变），进度该绕回开头
  // 而不是钉在 100%；不循环时超出就 clamp，等下一条锚点纠正
  const position =
    track.durationMs > 0
      ? track.repeatOne
        ? elapsed % track.durationMs
        : Math.min(track.durationMs, elapsed)
      : elapsed;
  const percent = track.durationMs ? (position / track.durationMs) * 100 : 0;

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
      <div className="mt-1.5 h-0.75 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-700 ease-linear",
            playing ? "bg-live" : "bg-muted-foreground",
          )}
          style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
        />
      </div>
    </>
  );
}

function TrackRow({ track }: { track: ListeningItem }) {
  const content = (
    <>
      <div className="relative size-9 shrink-0 overflow-hidden rounded-sm border border-line bg-muted">
        {track.artwork && (
          <Image
            src={appleArtwork(track.artwork, 36 * ARTWORK_SCALE)!}
            alt=""
            fill
            sizes="36px"
            className="object-cover"
            unoptimized
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
      <div className="size-9 shrink-0 animate-pulse rounded-sm bg-muted" />
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
function useRowSnap(topKey: string | undefined) {
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

  /**
   * 用 ref 回调而不是 useEffect 挂监听：这段列表是条件渲染的
   * （加载中/有数据才出现），挂载那一刻节点可能还不存在，
   * 空依赖的 effect 就再也没有第二次机会去绑。ref 回调是节点一出现就调。
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

/** 有链接就整块可点，没有就退化成普通容器 */
function HeroWrapper({
  link,
  children,
}: {
  link: string | null;
  children: ReactNode;
}) {
  const className = "group flex gap-3 rounded-md";
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
  /**
   * 本机 Music.app 正在放的那首（而不是 Apple Music 的历史记录）。
   * 有值就说明能拿到播放进度，副标题行会换成带进度条的版本。
   */
  track: LocalNowPlaying | null;
};

export function ListeningCard({ className }: { className?: string }) {
  const { data, error, isLoading } = useStatus<ListeningPayload>(
    LISTENING_PATH,
    REFRESH_MS,
  );
  const { connected } = useLiveStream();
  const { data: live } = useStatus<MusicPayload>(
    MUSIC_PATH,
    connected ? MUSIC_PUSHED_REFRESH_MS : MUSIC_REFRESH_MS,
  );

  const reduced = useReducedMotion();

  // MacBook 与 HomePod 都没有可用状态时才退回最近播放列表。
  const localMusic = live?.idle ? null : live?.music ?? null;
  const localTrack =
    localMusic?.title && localMusic.state !== "stopped" ? localMusic : null;
  // 服务端已经按暂停宽限期选好来源；前端只渲染结果，避免两套计时器产生闪烁。
  const localActive = Boolean(localTrack);

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
   * 总时长去算，于是刚按下暂停、宽限期一过，卡片反而从「已暂停」翻成绿色的
   * 「播放中」。等别的条目顶上来，这层压制自然就解除了。
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
        label: localTrack!.state === "playing" ? "播放中" : "已暂停",
        playing: localTrack!.state === "playing",
        track: localTrack,
      }
    : latest
      ? {
          key: latest.id,
          artwork: latest.artwork,
          title: latest.title,
          subtitle: latest.artist,
          link: latest.link,
          label: playing ? "播放中" : "最近听过",
          playing,
          track: null,
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
  const listRef = useRowSnap(restKeys[0]);

  return (
    <Card label="Recently Played" action="Apple Music" className={className}>
      <div className="flex flex-1 flex-col px-4 pb-4 pt-3">
        {/* 最近的一项放大展示。整块都是链接 —— 点封面也能跳转。
            换专辑/歌单时新旧叠着交叉淡入，见 HERO_VARIANTS。

            首屏「读取中」不进 AnimatePresence：占位态和 hero 根本不是同一个东西，
            让它们互相淡入淡出没有意义，只会在数据到达时糊一下。等有数据再挂载，
            initial={false} 就会直接跳过入场动画，首屏不播这一下。 */}
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
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={hero.key}
            variants={reduced ? STATIC_VARIANTS : HERO_VARIANTS}
            initial="initial"
            animate="animate"
            exit="exit"
            // 非对称时长写在 variant 里，这里传统一的 transition 会把它抹平
            transition={reduced ? STATIC_TRANSITION : undefined}
          >
            <HeroWrapper link={hero.link}>
              <div className="relative aspect-square w-20 shrink-0 overflow-hidden rounded-md border border-line bg-muted">
                {hero.artwork ? (
                  <Image
                    src={appleArtwork(hero.artwork, 80 * ARTWORK_SCALE)!}
                    alt={`${hero.title} 封面`}
                    fill
                    sizes="80px"
                    className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                    unoptimized
                  />
                ) : null}
              </div>

              {/*
            不用统一的 gap：三行的行内 leading 不一样（标签行盒高贴合文字，
            标题和副标题各自还有 3px 内部余白），统一 gap 会让视觉间隙一宽一窄。
            这里按实测的 leading 差额补偿，让两处视觉间隙都落在 8px 左右。
          */}
              <div className="flex min-w-0 flex-1 flex-col justify-center">
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
                        <Speaker className="size-3 shrink-0" aria-hidden />
                      ) : (
                        <Laptop className="size-3 shrink-0" aria-hidden />
                      )}
                      <span className="truncate">
                        {hero.track.source === "homepod" ? "HomePod mini" : "MacBook Pro"}
                      </span>
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
                  <HeroProgress track={hero.track} subtitle={hero.subtitle} />
                ) : (
                  <>
                    <div
                      className="mt-px truncate text-sm text-muted-foreground"
                      title={hero.subtitle}
                    >
                      {hero.subtitle}
                    </div>
                    {/* 占位，尺寸和 HeroProgress 那根进度条一模一样。历史条目没有
                        进度可显示，但两版 hero 的高度必须一致，理由同上面那段。 */}
                    <div className="mt-1.5 h-0.75" aria-hidden />
                  </>
                )}
              </div>
            </HeroWrapper>
          </motion.div>
        </AnimatePresence>
        )}

        {/*
          再往前的几项。上游最多给 10 条，全部列出，放不下就滚动。

          加载中也要把这块的位置占住（渲染骨架行），否则卡片会先矮一截、
          数据到了再撑高 —— 两张卡在同一 grid 行里，会一起跳。
          这块吃掉卡片剩下的全部高度，行高由 useRowMetrics 平摊，
          所以底部不会留空，也不会露出半行。
        */}
        {(isLoading || rest.length > 0) && (
          // 边框和内边距放在外层，滚动容器本身不带 padding ——
          // 否则吸附位会被 padding 顶偏，还得再补 scroll-padding
          // min-h-0 不能少：flex 子项默认 min-height:auto，会被内容撑破而不是滚动
          <div className="mt-3 flex flex-1 flex-col border-t border-line pt-2">
            {/*
              滚动容器绝对定位，是为了让它对「这张卡有多高」完全没有发言权。
              grid 行按 max-content 定高：让它参与的话，10 条 × 行高会被当成
              卡片的固有高度，整个「此刻」区块被撑到近两倍（实测 364 → 588）。
              绝对定位的子元素不参与固有尺寸计算，卡片高度就还是由充电头那张
              决定，这里只负责把分到的空间填满。min-height 是这块唯一的话语权。
            */}
            <div
              className="relative flex-1"
              style={{ minHeight: `${MIN_ROW_HEIGHT_PX * VISIBLE_ROWS}px` }}
            >
              <div
                ref={listRef}
                className={cn(
                  // 每行高 = 容器的 1/N。容器高度是确定的（absolute inset-0），
                  // 百分比轨道就有得算 —— 于是「整数行」「填满」两件事同时由
                  // CSS 保证，不需要 ResizeObserver 去量、也没有写死的行高。
                  "absolute inset-0 grid overflow-y-auto",
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
                ) : (
                  Array.from({ length: VISIBLE_ROWS }, (_, i) => (
                    <SkeletonRow key={i} />
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
