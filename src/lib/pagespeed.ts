import { claim, get, put, remove } from "@/lib/cache";
import { site } from "@/lib/site";
import type { LighthouseVitals, PageSpeedPayload, PageSpeedSample } from "@/lib/vercel-deployments-types";

const ENDPOINT = "https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed";
/** 整份响应带着截图有 800 KB；只要评分和这几条审计，Worker 不必解一遍图。 */
const FIELDS = "captchaResult,lighthouseResult(categories/performance/score,audits)";
/** 实测一次二十多秒，别按访问频率跑：一小时一轮，一轮两端分两次跑。 */
const REFRESH_INTERVAL_MS = 3_600_000;
/**
 * 一轮失败之后隔多久再试。
 *
 * 不让失败白烧掉一整个小时 —— runPagespeed 会偶发 500（`Lighthouse returned
 * error`，自己跑十轮撞见过两轮），一小时一次的节奏下，一次偶发就是一小时的
 * 窗口空档。成功那次按小时记账，失败只占住这几分钟，下一轮很快重来。
 */
const RETRY_INTERVAL_MS = 5 * 60_000;
/** 连续失败时页面继续显示上次实测，超过一天才回到「—」。 */
const KEEP_MS = 86_400_000;
/**
 * 参与中位数的滚动窗口：只算这段时间里跑过的轮次，按小时一轮大约六个样本。
 *
 * 窗口用时间而不是条数定 —— Worker 停过一段时间之后，剩下的样本该是真的近期
 * 实测，不是几天前那几轮凑数。窗口里只剩一轮时中位数就是那一轮。
 */
const WINDOW_MS = 6 * 3_600_000;
/** 窗口内万一跑得比预期密（比如改了 cron），也不把无上限的历史塞进一条记录。 */
const MAX_SAMPLES = 12;
// v2：v1 存的是单轮实测，没有窗口字段，升键让线上那份直接作废。
const CACHE_KEY = `pagespeed:v2:${site.url}`;
const HISTORY_KEY = `${CACHE_KEY}:history`;
/** 这一小时已经测过了。成功才写，所以失败不占住整点到整点那一格。 */
const DONE_KEY = `${CACHE_KEY}:done`;
/** 正在测。挡住并发和紧接着的重试，失败时只占住 RETRY_INTERVAL_MS。 */
const ATTEMPT_KEY = `${CACHE_KEY}:attempt`;
/** 这一轮里先测完的桌面端，等下一次 cron 把移动端补上再合成一个样本。 */
const PENDING_KEY = `${CACHE_KEY}:pending`;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("PageSpeed 结果格式无效");
  return value as Record<string, unknown>;
}

function numeric(audits: Record<string, unknown>, id: string): number | null {
  const raw = audits[id] == null ? null : record(audits[id]).numericValue;
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : null;
}

/**
 * 只取 Lighthouse 实验室数据。
 *
 * PSI 同时会返回 CrUX 真实用户字段（`loadingExperience`），但这个站的流量远不够
 * 进 CrUX 数据集，那两段是空的 —— 展示的是一台模拟设备上的单次实测，不是访客
 * 实际体验，所以没有 INP（它只有真实用户才测得到），用同一轮测出的 TBT 代替。
 *
 * 整轮跑通但个别审计测不出时按空值处理，不因为一个指标把整张表判死。
 */
export function parsePageSpeed(raw: unknown): LighthouseVitals {
  const response = record(raw);
  if (response.captchaResult != null && response.captchaResult !== "CAPTCHA_NOT_NEEDED") throw new Error("PageSpeed 要求人机验证");
  const lighthouse = record(response.lighthouseResult);
  const audits = record(lighthouse.audits);
  const performance = record(lighthouse.categories).performance;
  const ratio = performance == null ? null : record(performance).score;
  if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio < 0 || ratio > 1) throw new Error("PageSpeed 性能评分缺失");
  const cls = numeric(audits, "cumulative-layout-shift");
  const round = (value: number | null) => value == null ? null : Math.round(value);
  return {
    score: Math.round(ratio * 100),
    lcpMs: round(numeric(audits, "largest-contentful-paint")),
    tbtMs: round(numeric(audits, "total-blocking-time")),
    cls: cls == null ? null : Number(cls.toFixed(3)),
    fcpMs: round(numeric(audits, "first-contentful-paint")),
    // Lighthouse 的 TTFB 审计叫 server-response-time，只计根文档
    ttfbMs: round(numeric(audits, "server-response-time")),
  };
}

/** 密钥只走查询参数（接口只认这一种），错误信息里只带状态码。 */
export async function fetchPageSpeed(url: string, strategy: "desktop" | "mobile", key: string): Promise<LighthouseVitals> {
  const endpoint = new URL(ENDPOINT);
  endpoint.search = new URLSearchParams({ url, strategy, category: "performance", fields: FIELDS, key }).toString();
  // 单端实测二十多秒。留 60 秒的余量，卡住的那次要落进自己的 catch 里（有日志），
  // 别拖到被平台掐断 —— 那种死法不留任何痕迹
  const response = await fetch(endpoint, { headers: { "User-Agent": "lyjwpage-pagespeed" }, signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`PageSpeed 查询失败 (${response.status})`);
  return parsePageSpeed(await response.json());
}

function middle(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const half = sorted.length >> 1;
  // 偶数个取中间两个的平均，这是中位数本来的定义，不是随便挑一边
  return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2;
}

/**
 * 每一格各自取中位数，所以这一行不是某一轮的完整报告。
 *
 * 窗口里某几轮测不出某个指标时，那个格子只按测出来的那几轮算；一轮都没测出
 * 才是空。要的是「这个指标平时是多少」，逐格取中位数正好答这个。
 */
function summarize(samples: PageSpeedSample[], device: "desktop" | "mobile"): LighthouseVitals {
  const pick = (key: Exclude<keyof LighthouseVitals, "score">) =>
    middle(samples.map((row) => row[device][key]).filter((value): value is number => value != null));
  const round = (value: number | null) => value == null ? null : Math.round(value);
  const score = middle(samples.map((row) => row[device].score));
  if (score == null) throw new Error("PageSpeed 窗口内没有样本");
  const cls = pick("cls");
  return {
    score: Math.round(score),
    lcpMs: round(pick("lcpMs")), tbtMs: round(pick("tbtMs")),
    cls: cls == null ? null : Number(cls.toFixed(3)),
    fcpMs: round(pick("fcpMs")), ttfbMs: round(pick("ttfbMs")),
  };
}

/** 存进去的是自己写的 JSON，回来时只挡结构对不上的脏数据（升键、手改）。 */
function isSample(value: unknown): value is PageSpeedSample {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  const vitals = (device: unknown) => !!device && typeof device === "object" && typeof (device as LighthouseVitals).score === "number";
  return typeof row.at === "number" && Number.isFinite(row.at) && vitals(row.desktop) && vitals(row.mobile);
}

/**
 * 把一轮实测并进滚动窗口，重算中位数。
 *
 * 单轮的波动不小 —— Google 那边的跑测机偶尔卡一下，TBT 和总分能跳出明显偏低的
 * 一轮。窗口里保留最近几小时的实测，逐格取中位数，一轮异常就被旁边几轮压住。
 * 代价是滞后：真的变慢了也要过半个窗口才在卡片上稳下来。
 */
export function mergePageSpeed(previous: unknown, next: PageSpeedSample): { history: PageSpeedSample[]; payload: PageSpeedPayload } {
  const history = [...(Array.isArray(previous) ? previous.filter(isSample) : []), next]
    .filter((row) => next.at - row.at < WINDOW_MS)
    .sort((a, b) => a.at - b.at)
    .slice(-MAX_SAMPLES);
  return {
    history,
    payload: {
      fetchedAt: next.at, url: site.url, samples: history.length, start: history[0].at,
      desktop: summarize(history, "desktop"), mobile: summarize(history, "mobile"),
    },
  };
}

/**
 * 每小时实测一次，只由 API Worker 的 cron 调用（每分钟进来一次，自己判该不该跑）。
 *
 * 读路径等不起这二十多秒，所以它一步都不去跑上游：这里跑完并进窗口再写进缓存，
 * 页面永远只读已经算好的那份。
 *
 * **一次 cron 只测一端**：先桌面、攒进 `pending`，下一次 cron 补上移动端再合成
 * 一个样本。两端并行跑过，线上实测一次占 96 秒（cron 日志里的 wallTime，跑完了、
 * 没被掐）—— 能跑通，但一次定时调用占着一分半实在长，上游慢一点就没有余量。
 * 拆成两次之后每次三四十秒，加上 60 秒的 fetch 超时，卡住的那次会落进下面的 catch。
 *
 * 两把闸门分开：`done` 成功才写、占一小时，它决定节奏；`attempt` 一进来就抢、
 * 只占几分钟，它挡并发和紧接着的重试。合成一把的话（从前就是），上游一次偶发
 * 500 就把整个小时烧掉 —— 而 runPagespeed 确实会偶发 500。
 */
export async function refreshPageSpeed(): Promise<void> {
  const key = process.env.PAGESPEED_API_KEY?.trim();
  if (!key) return;
  if (await get(DONE_KEY)) return;
  if (!await claim(ATTEMPT_KEY, RETRY_INTERVAL_MS)) return;
  try {
    const pending = await get<{ desktop: LighthouseVitals }>(PENDING_KEY);
    if (!pending?.desktop) {
      const desktop = await fetchPageSpeed(site.url, "desktop", key);
      // 攒着等下一次 cron。这一轮没在一小时里凑齐就作废，重新从桌面端开始
      await put(PENDING_KEY, { desktop }, REFRESH_INTERVAL_MS);
      return;
    }
    const mobile = await fetchPageSpeed(site.url, "mobile", key);
    const { history, payload } = mergePageSpeed(await get(HISTORY_KEY), { at: Date.now(), desktop: pending.desktop, mobile });
    // pending 是「这一轮还没提交」的凭证，必须赶在 history 落盘之前消费掉。
    //
    // 反过来（先写 history、最后清 pending）的话：Worker 侧的 storage 写失败是冒泡的
    // （`workers/api/src/storage-driver.ts` 特意不吞错），history 写完之后任何一步抛了都
    // 会落进下面的 catch —— done 没写成、pending 原样留着。五分钟后 attempt 过期，下一轮
    // 拿同一份 desktop 再测一次 mobile 又追加一条，而 mergePageSpeed 只按 at 追加、不去重，
    // 窗口里就多出一个共用同一份 desktop 的样本，中位数被拽偏；done 一直写不成时还会每五
    // 分钟重放一次，把 MAX_SAMPLES 那 12 格填满，真样本被挤出去。
    //
    // 先消费再提交之后，最坏是 history 写失败、这一轮的 desktop 白测：pending 已经空了，
    // 下一轮从桌面端重新开始。丢一轮实测远好过让重复样本污染六小时窗口。
    await remove(PENDING_KEY);
    await put<PageSpeedSample[]>(HISTORY_KEY, history, KEEP_MS);
    await put<PageSpeedPayload>(CACHE_KEY, payload, KEEP_MS);
    // 写成了才记账，下一轮隔一小时；写之前抛了就只等 RETRY_INTERVAL_MS
    await put(DONE_KEY, Date.now(), REFRESH_INTERVAL_MS);
  } catch (error) {
    console.warn("[pagespeed]", error instanceof Error ? error.message : String(error));
  }
}

export async function getPageSpeed(): Promise<PageSpeedPayload | null> {
  return await get<PageSpeedPayload>(CACHE_KEY) ?? null;
}
