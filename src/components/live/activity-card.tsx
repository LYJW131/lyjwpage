"use client";

import NumberFlow from "@number-flow/react";

import { Card } from "@/components/ui/card";
import { useStatus } from "@/hooks/use-status";
import { ACTIVITY_PATH } from "@/lib/paths";
import type { ActivityPayload, StatusResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 5 分钟一轮，比全站任何一张卡都慢，而且是故意的。
 *
 * 上报侧的天花板在 HealthKit：后台投递按小时节流，App 不在前台时最快也就一小时
 * 一份。5 分钟已经是十几倍的过采样，调到 30 秒只是把请求翻十倍换同一份数据 ——
 * 「前端轮询多快，回源频率都不变」在这里反过来也成立：上报多慢，轮询快了也没用。
 *
 * 这条链路上没有实时推送，理由见 lib/activity 的模块注释。
 */
const REFRESH_MS = 5 * 60_000;

type RingId = "move" | "exercise" | "stand";

/**
 * 三环。半径从外到内，笔宽 11、环间留 1.5 —— 最外圈的外沿正好落在 viewBox 边上。
 *
 * 顺序不能改：Apple 那套从外到内就是活动 / 锻炼 / 站立，换了顺序的话，一眼认圈
 * 的人全会读错。
 */
const RINGS: ReadonlyArray<{
  id: RingId;
  label: string;
  unit: string;
  radius: number;
}> = [
  { id: "move", label: "活动", unit: "千卡", radius: 44.65 },
  { id: "exercise", label: "锻炼", unit: "分钟", radius: 32.72 },
  { id: "stand", label: "站立", unit: "小时", radius: 20.54 },
];

/**
 * 笔宽和三条中线半径**是从 Apple 健身 App 的截图上量出来的**，不是估的。
 *
 * 量法：以圆心为原点，沿 3 点方向扫亮像素得到每条环带的内外半径（12 点方向不行，
 * 那里压着字形），再用 12 点/3 点两个方向交叉校正圆心 —— 圆心先按「最宽的那一行」
 * 定位过一次，被环带外的微弱发光带偏了 18px，三条带宽因此全错。
 *
 * 原图：外半径 406.5px、带宽 87px、中线 363 / 266 / 167、环间距 ~10.5px。
 * 除以 406.5/50 换算到这个 viewBox：
 */
const STROKE = 10.7;

/** 字形笔画。原图上量到 6px，同样的比例尺换算过来 */
const GLYPH_STROKE = 0.74;

type RingValue = { id: RingId; label: string; unit: string; radius: number; value: number; goal: number };

/**
 * `current` 为假 = 手表那边已经跨过午夜，而这份快照说的是上一天。
 *
 * **那时三个读数一律按 0 画**，不画昨天那份。手表零点就把圈清了，站点该显示的是
 * 「这会儿那三个圈长什么样」—— 举着昨天的满环是更大的错。目标值照旧沿用上一封：
 * 它不跟着日子重置，人也不会天天改。
 *
 * 代价说清楚：这等于在下一封上报到达之前，替手表断言「今天还是 0」。零点刚过时这
 * 是对的；上报器每小时来一封，所以偏差窗口就是那一小时。真要更严谨得让上报器在
 * 跨天时立刻推一封，但那是拿一次唤醒换一小时的精度，不值。
 */
function ringValues(data: ActivityPayload | undefined, current: boolean): RingValue[] {
  return RINGS.map((ring) => ({
    ...ring,
    value: !current
      ? 0
      : ring.id === "move"
        ? (data?.moveKcal ?? 0)
        : ring.id === "exercise"
          ? (data?.exerciseMinutes ?? 0)
          : (data?.standHours ?? 0),
    goal:
      ring.id === "move"
        ? (data?.moveGoalKcal ?? 0)
        : ring.id === "exercise"
          ? (data?.exerciseGoalMinutes ?? 0)
          : (data?.standGoalHours ?? 0),
  }));
}

/** 完成度。目标为 0 时按 0 算，别让它变成 NaN 或者 Infinity */
function ratio(ring: RingValue) {
  return ring.goal > 0 ? ring.value / ring.goal : 0;
}

/**
 * 第二圈圆头前方那道影子的**衰减曲线**，从截图上量的。
 *
 * `[距圆头边缘多少个单位, 压暗多少]`：紧贴着是压到四成，然后沿弧渐渐回到原色，
 * 跨度约 4 个单位。三条环带都是这个形状。
 *
 * 为什么不用 `feDropShadow`：高斯模糊在圆头边缘只剩半个不透明度，`floodOpacity`
 * 拉满也到不了这里第一档的 0.6，而且它的衰减是高斯的、和实测这条对不上。
 * 手写渐变反倒简单，还能一眼看出每一档是照着什么来的。
 */
const CAP_SHADOW: ReadonlyArray<[number, number]> = [
  [0, 0.6],
  [1, 0.45],
  [2, 0.28],
  [3, 0.14],
  [4, 0],
];

/** 影子往圆头前方铺多远（单位），也就是上面那张表的最后一档 */
const CAP_SHADOW_REACH = CAP_SHADOW[CAP_SHADOW.length - 1][0];

/**
 * 三条同心弧 + 三个环头字形。
 *
 * 从 12 点开始顺时针，所以整体转 -90°。
 *
 * **超过一圈会接着绕**：先铺满整圈，再把多出来的那一小段叠在上面，带圆头和一道
 * 投影 —— Apple 就是这么画的。少了投影这一段完全看不见（同色叠同色），少了叠画
 * 则 229% 和 100% 长得一模一样。绕第三圈、第四圈仍然只画小数部分：视觉上本来就
 * 分不出几圈，圈数由旁边的数字负责说。
 */
function Rings({ rings, className }: { rings: RingValue[]; className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label={rings
        .map((ring) => `${ring.label} ${Math.round(ring.value)} / ${ring.goal} ${ring.unit}`)
        .join("，")}
    >
      <defs>
        {/*
          每条环带一层遮罩：白色的那一圈就是这条带子本身，影子被关在里面，
          溢不到轨道外面去。Apple 那道也是齐着带子边缘切断的。
        */}
        {RINGS.map((ring) => (
          <mask key={`${ring.id}-band`} id={`activity-${ring.id}-band`}>
            <circle
              cx="50"
              cy="50"
              r={ring.radius}
              fill="none"
              stroke="#fff"
              strokeWidth={STROKE}
            />
          </mask>
        ))}
        {RINGS.map((ring) => (
          <linearGradient
            key={ring.id}
            id={`activity-${ring.id}-arc`}
            x1="0"
            y1="1"
            x2="1"
            y2="0"
          >
            <stop offset="0%" stopColor={`var(--activity-${ring.id})`} />
            <stop offset="100%" stopColor={`var(--activity-${ring.id}-lit)`} />
          </linearGradient>
        ))}
      </defs>

      {rings.map((ring) => {
        const circumference = 2 * Math.PI * ring.radius;
        const done = ratio(ring);
        const filled = Math.min(done, 1);
        // 绕满一圈之后多出来的那一小段（只取小数部分，见上面的注释）
        const overflow = done > 1 ? done % 1 : 0;
        // 第二圈那个头落在哪儿：从 12 点顺时针转过 overflow 圈
        const capAngle = overflow * 2 * Math.PI - Math.PI / 2;
        const capX = 50 + ring.radius * Math.cos(capAngle);
        const capY = 50 + ring.radius * Math.sin(capAngle);
        return (
          <g key={ring.id} style={{ color: `var(--activity-${ring.id})` }}>
            <circle
              cx="50"
              cy="50"
              r={ring.radius}
              fill="none"
              stroke="currentColor"
              strokeOpacity={0.16}
              strokeWidth={STROKE}
            />
            {/*
              12 点那个圆头**恒亮**，不跟着读数走。

              Apple 就是这么画的：读数为 0 时那三圈也各留一个圆头，字形正压在上面。
              上一版把 0 的那条整段不画，字形就悬在暗轨道上，看着像块脏东西。
              半径正好是笔宽的一半 —— 它本来就是那条弧的圆头。
            */}
            <circle cx="50" cy={50 - ring.radius} r={STROKE / 2} fill="currentColor" />
            {/*
              **读数为 0 也照画这条弧**，长度归零就是了。

              元素常驻，`stroke-dashoffset` 才有得过渡 —— 条件渲染的话，从 0 涨到第一个
              非零值那一次是新建元素，没有起始状态，会硬跳过去；之后每次才滑。
              早先在 0 时不画，是为了躲圆头笔在零长度上点出来的那个点；现在 12 点那个
              圆头本来就恒亮画着，那个点正好落在它下面，看不出来。
            */}
            <circle
              cx="50"
              cy="50"
              r={ring.radius}
              fill="none"
              stroke={`url(#activity-${ring.id}-arc)`}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={circumference}
              /*
                **必须走 style，不能写成表现属性。**

                改 SVG 的表现属性（`stroke-dashoffset="…"`）不会触发 CSS 过渡，浏览器
                直接跳到新值 —— 属性挂着 transition 也没用。实测过：读数从 0 跳到满环，
                每 100ms 采一次 `stroke-dashoffset`，拿到的是 281 → 0，中间一帧都没有。
                写进 `style` 之后才是真的在插值。
              */
              style={{ strokeDashoffset: circumference * (1 - filled) }}
              transform="rotate(-90 50 50)"
              className="transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none"
            />
            {overflow > 0 && (
              <>
                {/*
                  **影子只在末端那个头下面，起点没有。**

                  先在弧的末端画一个带投影的圆头，再把整段弧盖上去 —— 弧自己遮住那个
                  圆头，只剩溢出到身下环带上的那一圈影子。上一版把 filter 挂在整段弧上，
                  于是 12 点那个起点也投了影：那里本来就和底下那圈严丝合缝，凭空多出
                  一道黑边。对着原图看，Apple 只有末端有。
                */}
                {/*
                  影子：一个以圆头为心的径向渐变，铺在圆头**前方**的环带上。

                  渐变的内圈半径正好是圆头本身（笔宽的一半），所以第一档 0.6 就落在
                  圆头边缘那一圈上；往外按实测的表衰减到 0。四周一圈匀 —— 带方向的话
                  弧的一侧重一侧轻，一眼假。整块罩在环带的遮罩里，溢不出轨道。
                */}
                <g mask={`url(#activity-${ring.id}-band)`}>
                  <radialGradient
                    id={`activity-${ring.id}-cap-shadow`}
                    gradientUnits="userSpaceOnUse"
                    cx={capX}
                    cy={capY}
                    r={STROKE / 2 + CAP_SHADOW_REACH}
                  >
                    {CAP_SHADOW.map(([at, alpha]) => (
                      <stop
                        key={at}
                        offset={(STROKE / 2 + at) / (STROKE / 2 + CAP_SHADOW_REACH)}
                        stopColor="#000"
                        // 按主题打折，见 globals.css 的 --activity-shadow
                        style={{ stopOpacity: `calc(${alpha} * var(--activity-shadow))` }}
                      />
                    ))}
                  </radialGradient>
                  <circle
                    cx={capX}
                    cy={capY}
                    r={STROKE / 2 + CAP_SHADOW_REACH}
                    fill={`url(#activity-${ring.id}-cap-shadow)`}
                  />
                </g>
                <circle
                  cx="50"
                  cy="50"
                  r={ring.radius}
                  fill="none"
                  stroke={`url(#activity-${ring.id}-arc)`}
                  strokeWidth={STROKE}
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  // 同上，走 style 才有过渡
                  style={{ strokeDashoffset: circumference * (1 - overflow) }}
                  transform="rotate(-90 50 50)"
                  className="transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none"
                />
              </>
            )}
          </g>
        );
      })}

      {/*
        环头那三个字形。**钉在 12 点，不跟着弧头走** —— Apple 那三个也是固定的：
        它们说的是「这一圈是哪一项」，不是「进度到哪儿了」。画在所有弧之后，压在最上面。

        坐标是从截图上量的（字形 5.29×6.15 / 6.89×5.41 / 6.15×6.15 单位，笔画 0.74）。
        形状也是量出来才看清的：活动是**一根杆 + 一个人字**，锻炼是**一根杆 + 两个人字**
        （不是两个人字并排），站立是活动那个转 90°。人字一律 45°。

        描的是卡片底色，看着像从环上挖掉的 —— Apple 描的是纯黑，因为它那个 App 永远是
        深色底；这里深浅两套都要成立，所以跟着底色走。
      */}
      {rings.map((ring) => (
        <g
          key={`${ring.id}-glyph`}
          transform={`translate(50 ${50 - ring.radius})`}
          fill="none"
          stroke="var(--activity-ink)"
          strokeWidth={GLYPH_STROKE}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {ring.id === "move" && <path d="M-2.65 0 H2.3 M-0.42 -3.07 L2.65 0 L-0.42 3.07" />}
          {ring.id === "exercise" && (
            <path d="M-3.43 0 H0.65 M-1.51 -2.58 L1.11 0 L-1.51 2.58 M0.65 -2.58 L3.26 0 L0.65 2.58" />
          )}
          {ring.id === "stand" && <path d="M0 2.65 V-2.3 M-3.07 0.42 L0 -2.65 L3.07 0.42" />}
        </g>
      ))}
    </svg>
  );
}


export function ActivityCard({
  fallback,
  className,
}: {
  fallback: StatusResponse<ActivityPayload>;
  className?: string;
}) {
  const { data, error, isLoading } = useStatus<ActivityPayload>(ACTIVITY_PATH, REFRESH_MS, {
    fallback,
  });

  /**
   * 这份圈说的还是不是「今天」。**只信源站在取数出口盖的那一个**
   * （见 ActivityPayload 的 currentAtSource）。
   *
   * 浏览器不自己算：它手上没有一个会走的钟 —— `useMountedAt` 是挂载那一刻的定格，
   * 拿它比日期的话，开着不动的标签页永远停在挂载那一天，跨夜之后新到的**今天**那份
   * 反而会被判成「昨天的记录」，正好把这个判定用反。
   *
   * 代价是手表那边跨过午夜后最多晚 5 分钟才翻（下一轮轮询会带回新的判定，
   * 端点每次请求现算）；首屏那份还可能再旧几分钟，挂载时的那次回源会纠正它。
   */
  const current = Boolean(data?.currentAtSource);

  const rings = ringValues(data, current);

  /**
   * 底下那行字**只在一份都没收到时才出现**。
   *
   * 「几分钟前更新」刻意没有：圈以分钟为尺度涨，那行字每分钟都在变，而它说的事
   * 没人需要盯着。跨天也不再写「昨天的记录」了 —— 那一刻圈本身已经归零，
   * 没有别的日子的数在屏幕上，也就没什么要交代的。
   */
  const note = (() => {
    if (isLoading && !data) return "读取中";
    if (error || !data) return "尚未收到活动上报";
    return null;
  })();

  return (
    /*
      **没有标题栏**，和时间卡一样。不是省事：环的外径要和那张卡上的钟相等（144px），
      整张卡又要和它一样高（min-h-44 = 176px），36px 的标题栏塞不进去 —— 几何把这件事
      定死了。这两张也因此成了一对同规格的仪表卡。
    */
    <Card className={cn("h-full", className)}>
      {/*
        环靠左、读数靠右，两边各留一个 padding —— 所以「环的左边到左沿」和「读数的
        右边到右沿」相等，而且都只有 padding 那么宽。整组居中也能让两侧相等，但那样
        会在卡片两边各空出一大块（实测 76px），中间反而挤在一起。
      */}
      <div className="flex h-full min-h-44 items-center justify-between gap-4 p-4 lg:gap-5 lg:p-5">
        {/* 尺寸类和时间卡那个钟逐字相同 —— 换个断点两边一起变，不会只有一边跟着走 */}
        <Rings rings={rings} className="size-32 shrink-0 md:size-36 lg:size-40" />

        <div className="min-w-0">
          {/*
            右栏必须**不高于环**（144px），否则它会把卡片撑得比时间卡高 —— 那两张卡
            要一样高。3×39 + 2×6 = 129，留着余量；改字号或者加行之前先算这笔账。
          */}
          <div className="grid gap-1.5">
            {rings.map((ring) => (
              <div key={ring.id} className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: `var(--activity-${ring.id})` }}
                  />
                  <span className="label-mono text-muted-foreground">{ring.label}</span>
                </div>
                {/* 一份都没收到时写占位符，不写 0 —— 「今天一动没动」和「还没收到上报」
                    是两件事，而目标值这时候本来就不在手上（它跟着上报一起来） */}
                <div className="truncate font-mono text-lg tabular-nums">
                  {data ? (
                    <NumberFlow value={Math.round(ring.value)} />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                  <span className="text-sm text-muted-foreground">
                    {` / ${data ? ring.goal : "—"} ${ring.unit}`}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {note && <p className="label-mono mt-2 truncate text-muted-foreground">{note}</p>}
        </div>
      </div>
    </Card>
  );
}
