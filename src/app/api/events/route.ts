import { subscribeStatus } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SSE：后端事件推给浏览器。
 *
 * 用 SSE 而不是 WebSocket —— Next 的 Route Handler 不支持 WebSocket 升级，
 * 上 WS 得自建 server；而这里的需求是单向的（后端发生了什么，通知前端），
 * SSE 正好，而且 EventSource 自带断线重连。
 *
 * 推的只是「哪一路变了」这个信号，不带数据本身：前端收到后自己重新取一次，
 * 这样这里不必关心各路数据的形状，权限和缓存也都还走原来的接口。
 */

/** 心跳间隔。反向代理常在 30~60 秒无数据时掐断连接 */
const HEARTBEAT_MS = 25_000;

export function GET(request: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      // 先回一条，让浏览器立刻认定连接已建立
      send(`retry: 3000\nevent: ready\ndata: {}\n\n`);

      const unsubscribe = subscribeStatus((event) => {
        send(`event: status\ndata: ${JSON.stringify(event)}\n\n`);
      });

      // 注释行（以 : 开头）不会触发 onmessage，只用来保活
      const heartbeat = setInterval(() => send(`: ping\n\n`), HEARTBEAT_MS);

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // 已经关了就算了
        }
      };

      request.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      // nginx 默认会缓冲响应，SSE 必须关掉，否则消息会被攒着不发
      "X-Accel-Buffering": "no",
    },
  });
}
