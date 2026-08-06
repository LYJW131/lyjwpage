import { EventEmitter } from "node:events";

import Redis from "ioredis";

import { getRedis, key } from "@/lib/redis";

/**
 * 后端事件总线。
 *
 * 数据是被推进来的（充电头 POST、Emby webhook），以前前端只能靠轮询才知道
 * 变了。这里把「有新数据」这件事广播出去，SSE 端点转发给浏览器，
 * 前端收到就立刻重新取一次，不用等下一个轮询周期。
 *
 * 进程内用 EventEmitter；跨进程/多实例再经 Redis 的发布订阅扇出 ——
 * 推送只会打到其中一个实例，其它实例上连着的浏览器也得收到。
 */

export type StatusChannel = "charger" | "watching" | "listening";

export type StatusEvent = {
  channel: StatusChannel;
  /** 事件产生时刻，前端可用来忽略乱序 */
  at: number;
};

const CHANNEL = key("events");

const local = new EventEmitter();
// SSE 连接可能很多，去掉默认 10 个监听器的告警
local.setMaxListeners(0);

let subscriber: Redis | null = null;
let subscribing = false;

/** 单独一条订阅连接：Redis 的订阅模式下该连接不能再发普通命令 */
function ensureSubscriber() {
  if (subscribing) return;
  const url = process.env.REDIS_URL;
  if (!url) return;
  subscribing = true;

  subscriber = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: false });
  subscriber.on("error", (error) => console.error("[events]", error.message));
  subscriber.subscribe(CHANNEL).catch((error) => console.error("[events]", error.message));
  subscriber.on("message", (_channel, payload) => {
    try {
      local.emit("status", JSON.parse(payload) as StatusEvent);
    } catch {
      // 坏消息直接丢掉，不影响这条连接后续的消息
    }
  });
}

/**
 * 广播「某一路数据变了」。
 *
 * 有 Redis 时只发到 Redis，不再本地 emit 一次：本进程的订阅连接会把它收回来，
 * 两边都做的话同一条事件会送达两次（实测 SSE 里每条都重复）。
 * 发布失败或没有 Redis，就退回本地 emit，至少本进程的连接不会漏。
 */
export async function publishStatus(channel: StatusChannel) {
  const event: StatusEvent = { channel, at: Date.now() };

  const redis = getRedis();
  if (redis) {
    try {
      await redis.publish(CHANNEL, JSON.stringify(event));
      return;
    } catch (error) {
      console.error("[events]", error instanceof Error ? error.message : String(error));
    }
  }

  local.emit("status", event);
}

export function subscribeStatus(listener: (event: StatusEvent) => void) {
  ensureSubscriber();
  local.on("status", listener);
  return () => local.off("status", listener);
}
