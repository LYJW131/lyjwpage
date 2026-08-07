import { type LiveEvent, publish, subscribe } from "@/lib/live-events";
import { getDesktopPayload, getMusicPayload } from "@/lib/telemetry";

// 需要常驻连接和进程内订阅，不能跑在 Edge，也不能被静态化
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 每隔这么久重发一次当前活动状态。
 *
 * 它同时干两件事：
 * 1. 当保活用，避免中间代理把闲置的长连接掐掉
 * 2. 让 payload 里的 `stale` 保持准确 —— 那个字段是服务端按「距上次收到上报
 *    多久」算出来的，是时间的函数。上报器彻底离线时不会再有新事件推过来，
 *    只有靠这个定时重发，前端才能看到状态翻成离线。
 */
const TICK_MS = 15_000;

function frame(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * 周期重发做成整个进程一个定时器，按连接数引用计数。
 *
 * 每条连接各起一个的话，同一份 payload 会被算 N 遍、Redis 也被打 N 次，
 * 而它们算出来的东西完全一样。publish 本来就会扇出给所有订阅者。
 */
let tickTimer: ReturnType<typeof setInterval> | null = null;
let tickRefs = 0;

function retainTick() {
  tickRefs += 1;
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    publish({ type: "desktop", payload: getDesktopPayload() });
    void getMusicPayload()
      .then((payload) => publish({ type: "music", payload }))
      .catch((error: unknown) => {
        console.error("[stream]", error instanceof Error ? error.message : String(error));
      });
  }, TICK_MS);
}

function releaseTick() {
  tickRefs -= 1;
  if (tickRefs > 0) return;
  tickRefs = 0;
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
}

export function GET(request: Request) {
  const encoder = new TextEncoder();
  let teardown: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let release: (() => void) | null = null;
      let holdsTick = false;

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (holdsTick) {
          holdsTick = false;
          releaseTick();
        }
        release?.();
        release = null;
        try {
          controller.close();
        } catch {
          // 已经关过或已出错，忽略
        }
      };
      teardown = cleanup;

      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // 对端已经走了但 abort 还没送达，按断开处理
          cleanup();
        }
      };
      // 首帧仍是每条连接自己发：新连上的人不该干等到下一个 tick
      const writeInitial = async () => {
        try {
          write(frame("desktop", getDesktopPayload()));
          write(frame("music", await getMusicPayload()));
        } catch (error) {
          console.error(
            "[stream]",
            error instanceof Error ? error.message : String(error),
          );
        }
      };

      request.signal.addEventListener("abort", cleanup);

      release = subscribe((event: LiveEvent) => {
        write(frame(event.type, event.payload));
      });
      // 首帧就写失败，或请求已经被取消 —— 上面刚建立的订阅要收回去
      if (closed || request.signal.aborted) {
        release?.();
        release = null;
        cleanup();
        return;
      }

      void writeInitial();
      holdsTick = true;
      retainTick();
    },
    cancel() {
      teardown?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform 很关键：压缩中间件会缓冲整个响应体，SSE 就再也推不出去了
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      // nginx 专用，等价于对这条响应关掉 proxy_buffering
      "X-Accel-Buffering": "no",
    },
  });
}
