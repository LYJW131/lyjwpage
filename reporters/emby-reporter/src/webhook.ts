import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

import { config } from "./config.js";
import { failure, info } from "./log.js";

/**
 * 接 Emby 的播放通知。
 *
 * Emby 后台那个 webhook 配置项加不了自定义请求头，直发站点就只能开一个不鉴权
 * 的入口 —— 站点将来在公网上，这不行。所以让它发到局域网里的这个端口，由代理
 * 带上密钥转发。别把这个端口映射到公网。
 *
 * **局域网内也不是零风险**：不配 WEBHOOK_TOKEN 的话，同网段任意一台机器发一条
 * 伪造的 playback.stop 就能抹掉站点上「正在观看」的卡片。「加不了自定义请求头」
 * 只排除了 header，地址里的 query 是能带的，所以密钥走 `?token=`。
 */

export type PlaybackEvent = "start" | "pause" | "resume" | "stop";

/** 请求体上限。播放通知只有几 KB，给这么多已经很宽了 */
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * Emby 各版本的事件名写法不一致（playback.start / PlaybackStart / playbackstart…），
 * 统一压成小写去掉分隔符再按子串判断，避免和具体写法绑死。
 */
function classify(event: string): PlaybackEvent | null {
  const e = event.toLowerCase().replace(/[._\-\s]/g, "");
  if (!e.includes("playback") && !e.includes("play")) return null;
  if (e.includes("stop")) return "stop";
  // unpause 里也含 pause，必须先判 unpause
  if (e.includes("unpause") || e.includes("resume")) return "resume";
  if (e.includes("pause")) return "pause";
  if (e.includes("start") || e.includes("progress")) return "start";
  return null;
}

function pick(source: Record<string, unknown> | null, ...names: string[]): unknown {
  if (!source) return undefined;
  for (const name of names) {
    if (source[name] != null) return source[name];
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function eventName(body: Record<string, unknown>): string {
  const value = pick(body, "Event", "event", "NotificationType", "Type");
  return typeof value === "string" ? value : "";
}

/**
 * 配了 WEBHOOK_TOKEN 就要求地址里带 `?token=<值>`，没配则不校验。
 *
 * 逐字节等时比较，别让 401 的返回快慢把密钥一位一位漏出去。
 * 路径仍然不校验（各版本的 Emby 对地址的处理不一样），只看这个 query。
 */
function authorized(target: string | undefined): boolean {
  const expected = config.webhookToken;
  if (!expected) return true;
  // Node 给的 request.url 只有路径和 query，拼个占位主机才解析得动
  const provided = new URL(target ?? "/", "http://localhost").searchParams.get("token");
  if (provided == null) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readBody(
  request: import("node:http").IncomingMessage,
): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("请求体过大");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * 事件只当触发器用，不当数据源：收到之后立刻去查一次会话，位置、暂停状态、
 * 设备名一律以 /Sessions 为准。webhook 各版本的字段位置本来就不一致，
 * 用它带的值等于把版本差异一路带到站点里去。
 */
export function startWebhookServer(onEvent: (event: PlaybackEvent) => void) {
  const server = createServer((request, response) => {
    if (request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }
    if (!authorized(request.url)) {
      response.writeHead(401).end();
      return;
    }

    void readBody(request)
      .then((text) => {
        // 先回，再干活：Emby 那边超时会重发，而我们要做的事（查会话、转发）
        // 比它的等待窗口长得多
        response.writeHead(204).end();

        const body = asRecord(JSON.parse(text));
        if (!body) return;
        const kind = classify(eventName(body));
        // 不是播放事件（媒体库更新之类），照收不误但什么都不做
        if (kind) onEvent(kind);
      })
      .catch((error) => {
        failure("webhook", error);
        if (!response.headersSent) response.writeHead(400).end();
      });
  });

  server.on("error", (error) => failure("webhook", error));
  server.listen(config.webhookPort, () => {
    info(`webhook 监听 :${config.webhookPort}，把 Emby 的通知地址指过来`);
    if (!config.webhookToken) {
      info("没配 WEBHOOK_TOKEN —— 局域网里谁都能往这个端口发一条伪造的播放事件");
    }
  });
  return server;
}
