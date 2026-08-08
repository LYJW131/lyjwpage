import { type LiveEvent, subscribe } from "@/lib/live-events";

// 需要常驻连接和进程内订阅，不能跑在 Edge，也不能被静态化
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 保活间隔。
 *
 * 从前这里是「每 15 秒重发一次完整活动状态」，理由有两条：保活，以及让
 * payload 里的 `stale` 保持准确。第二条其实站不住 —— 两张卡本来就一直在轮询
 * （SSE 连着时 30 秒一轮，断开时 3 秒），而 `stale` 是服务端按「距上次收到上报
 * 多久」算的、是时间的函数，轮询天然就能把它翻过来。为了这个每 15 秒广播一份
 * 没变化的状态，等于把 SSE 当轮询用了。
 *
 * 现在只发一个注释帧：不带数据、不查 Redis、不算 payload，纯粹防止中间代理
 * 把闲置的长连接掐掉。离线检测交给卡片自己的轮询。
 */
const KEEPALIVE_MS = 15_000;

function frame(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function GET(request: Request) {
  const encoder = new TextEncoder();
  let teardown: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let release: (() => void) | null = null;
      let keepalive: ReturnType<typeof setInterval> | null = null;

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (keepalive) {
          clearInterval(keepalive);
          keepalive = null;
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

      /*
       * 不发首帧。
       *
       * 卡片挂载时 SWR 本来就会拉一次，首帧只是把同一份状态再送一遍；
       * 而且算 music 那份要顺带查 HomePod 和 Apple Music 目录，等于每建立
       * 一条连接就白跑一遍。断线重连同理 —— 断开期间卡片是 3 秒一轮的快节奏，
       * 手上的状态最多差 3 秒。
       *
       * 下面这个是注释帧，浏览器会忽略它，只用来让连接上一直有字节流动。
       */
      keepalive = setInterval(() => write(": keepalive\n\n"), KEEPALIVE_MS);
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
