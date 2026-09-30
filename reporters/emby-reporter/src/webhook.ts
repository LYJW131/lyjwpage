import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

import { config } from "./config.js";
import { failure, info } from "./log.js";


export type PlaybackEvent = "start" | "pause" | "resume" | "stop";

const MAX_BODY_BYTES = 1024 * 1024;

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

function authorized(target: string | undefined): boolean {
  const expected = config.webhookToken;
  if (!expected) return true;
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
        // 必须先回执再查询/上报；处理耗时会触发 Emby 超时重发。
        response.writeHead(204).end();

        const body = asRecord(JSON.parse(text));
        if (!body) return;
        const kind = classify(eventName(body));
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
