import { createServer } from "node:http";

import { config } from "./config.js";
import { failure, info } from "./log.js";

/**
 * 接 Emby 的播放通知。
 *
 * Emby 后台那个 webhook 配置项加不了自定义请求头，直发站点就只能开一个不鉴权
 * 的入口 —— 站点将来在公网上，这不行。所以让它发到同机的这个端口，由代理带上
 * 密钥转发。局域网内可达即可，别把这个端口映射到公网。
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
  });
  return server;
}
