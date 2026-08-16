/**
 * 把一次上报原样转给对端部署。
 *
 * 两份生产各有一套自己的 Redis、自己的 live-push Worker、自己的 Next 缓存，而
 * 上报器只跟其中一个源站说话。所以收到上报的那份除了自己落库，还要把**同一个
 * 请求**原样再发一次给对面：对面进的是同一条路由、同一个 handler，于是它写自己
 * 的 Redis、推自己的 Worker、刷自己的 tag —— 三件事都在它自己那边发生，没有谁
 * 远程指挥谁。
 *
 * 从前跨部署传播的是「缓存失效」这一件事：一个 /api/ingest/revalidate 端点，收到
 * 上报的那份把 tag 名单发给对面。那条路只管缓存，数据本身仍然靠两边共用一个
 * Redis 才对得上 —— 于是国内那份的每一次读写都要跨一次海，而缓存又要单独再传播
 * 一遍。改成传播上报之后，缓存失效变成对端处理这次上报的自然结果，那个端点和它
 * 那套 tag 名单校验就都没有存在的必要了。
 *
 * **一跳就到，不再往下传。** 转发出去的请求带上 RELAY_HEADER，对端见到它就只落
 * 自己这份、不再转给别人 —— 两边互填对方，再传一次就成环了。三份以上也不用改：
 * 各自填齐其余几份，一跳照样到齐。
 */

/**
 * 转发标记。
 *
 * 只看有没有这个头，不看值 —— 它要表达的就是「这一份是对端转来的」这一件事。
 */
const RELAY_HEADER = "x-ingest-relay";

/**
 * 转发最多等多久。
 *
 * 对端收到之后要跑完整的落库和推送（推送自己还有 3 秒上限），跨海的握手也要算
 * 进来，所以比从前只传 tag 名单时（2.5 秒）宽一些。上限仍然要有：对端挂掉时不能
 * 让每一次上报都吊死在这里，上报器那边也有自己的耐心（Emby 代理 30 秒、Apple
 * Music 上报器 15 秒），超过就该由它重试而不是在这里干等。
 */
const RELAY_TIMEOUT_MS = 5_000;

function parsed(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** 裸主机名（`VERCEL_URL` 那样的）也能进来，统一取出 host */
function hostOf(raw: string | undefined | null): string | null {
  if (!raw) return null;
  return parsed(raw.includes("://") ? raw : `https://${raw}`)?.host ?? null;
}

/**
 * 对端源站名单。
 *
 * **每一份部署在自己的环境变量里填其余那几份的源**，不在代码里写死谁转给谁 ——
 * 地址属于部署环境，写进源码只会和现实脱节（从前这里举过两个具体域名，还正好举
 * 反了）。没配就不转发，本地 dev 也因此不会去敲线上。
 *
 * 自己被填进名单时要摘掉：一跳的限制只挡得住环，挡不住「把同一份上报在本地又跑
 * 了一遍」。名单是纯函数，好在测试里把这些边角一条条钉住。
 */
export function peerOrigins(
  raw: string | undefined,
  selfHosts: readonly (string | null | undefined)[] = [],
): string[] {
  if (!raw) return [];
  const mine = new Set(selfHosts.map(hostOf).filter((host): host is string => host != null));

  const origins: string[] = [];
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const url = parsed(trimmed);
    if (!url) {
      console.error("[relay] 对端地址不是合法 URL：", trimmed);
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      console.error("[relay] 对端地址要用 http:// 或 https://：", trimmed);
      continue;
    }
    // 同一个源填两遍就会转两次，两份一模一样的上报落在对端
    if (mine.has(url.host) || origins.includes(url.origin)) continue;
    origins.push(url.origin);
  }
  return origins;
}

/**
 * 转发到各对端，收集它们的回执。
 *
 * 回执要收是因为有些字段是**各部署各算的**：Emby 的 missingImages、Mac 的
 * desktopIconAvailable 都在问「你那边有没有这份图」，两边的 Redis 不是同一个，
 * 答案就可能不一样。上报器只跟一个源站说话，所以这些答案得在这里并起来再回给它，
 * 见各 handler 旁边的 merge*。
 *
 * 任何一个对端出问题都只记一行，不往上抛：那次上报在本地已经落库了，为对端的故障
 * 回一个 4xx 只会让上报器把同一份数据重发一遍、在本地又写一次。代价是对端会漏掉
 * 这一次变化 —— 列表类的上报器每 10 分钟兜底整推一次，能自己追上；Mac 那几份要等
 * 下一次内容变化。和推送一样是尽力而为。
 */
export async function relayIngest(request: Request, body: string): Promise<unknown[]> {
  // 对端转来的那份不再往下传，见文件头的单跳
  if (request.headers.get(RELAY_HEADER) != null) return [];

  /**
   * 这个函数**不能抛**：调用点在成功和失败两条路上都要 await 它，抛出来的话
   * 失败那条会在 catch 里二次抛出，一个写坏的报文就变成 500 而不是 400。
   * 所以自己的地址解析不出来也只是不转发。
   */
  const url = parsed(request.url);
  if (!url) return [];

  /**
   * `VERCEL_PROJECT_PRODUCTION_URL` 在 Preview 上指的是生产域 —— 于是 Preview
   * 永远转不到生产，正是我们要的（它本来也不该配对端）。EdgeOne 上这两个变量
   * 都没有，靠请求自己的 host 兜底。
   */
  const peers = peerOrigins(process.env.INGEST_PEERS, [
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
    url.host,
  ]);
  if (!peers.length) return [];

  const { pathname, search } = url;
  const secret = process.env.TELEMETRY_INGEST_SECRET;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    [RELAY_HEADER]: "1",
  };
  // 没配密钥时也照样转发：对端要是配了，它会回 401，那一行日志正是要看到的
  if (secret) headers.authorization = `Bearer ${secret}`;

  const receipts = await Promise.all(
    peers.map(async (origin) => {
      try {
        /**
         * 原样重发：同一条路径、同一段字节。**不重新序列化一遍** —— 解析再
         * 拼回去，两边收到的就不是同一份了，多一处能对不上的地方。
         */
        const response = await fetch(`${origin}${pathname}${search}`, {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
        });
        /**
         * 只按形状读，不做校验：`ok !== true` 对任何 JSON 值都成立（字符串、
         * 数组、null 上取 `.ok` 都是 undefined），下面 merge* 那侧也照样把回执
         * 当外部数据重新收敛一遍。代理那侧解析同一个信封时也是这么写的，
         * 见 reporters/emby-reporter/src/site.ts。
         */
        const envelope = (await response.json().catch(() => null)) as
          | { ok?: boolean; error?: string; data?: unknown }
          | null;
        if (!response.ok || envelope?.ok !== true) {
          // 带上对端给的原因：401 是密钥没对齐、400 是报文本身的问题，光看状态码要猜
          const reason = typeof envelope?.error === "string" ? `：${envelope.error}` : "";
          console.error("[relay]", origin, pathname, response.status, reason);
          return null;
        }
        return envelope.data;
      } catch (error) {
        console.error(
          "[relay]",
          origin,
          pathname,
          error instanceof Error ? error.message : String(error),
        );
        return null;
      }
    }),
  );

  return receipts.filter((receipt) => receipt != null);
}
