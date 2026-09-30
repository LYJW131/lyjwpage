
export const EARLY_LIVE_SOCKET_KEY = "__lyjwLiveSocket" as const;

export type EarlyLiveSocket = {
  socket: WebSocket;
  queue: string[];
  watchdog?: number;
};

declare global {
  interface Window {
    __lyjwLiveSocket?: EarlyLiveSocket;
  }
}

// 未水合的早开连接不会续心跳却仍被计为可见，必须自行超时关闭。
export const EARLY_LIVE_SOCKET_WATCHDOG_MS = 15_000;

export const EARLY_LIVE_SOCKET_QUEUE_LIMIT = 50;

// 内联脚本须转义小于号，防止 URL 中的结束标签逃逸出 script 元素。
export function earlyLiveSocketScript(url: string): string {
  const target = JSON.stringify(`${url}?visible=1`).replace(/</g, "\\u003c");
  const key = EARLY_LIVE_SOCKET_KEY;
  return (
    `try{if(document.visibilityState!=="hidden"){` +
    `var s=new WebSocket(${target});` +
    `var o={socket:s,queue:[]};` +
    `s.onmessage=function(e){if(typeof e.data==="string"&&o.queue.length<${EARLY_LIVE_SOCKET_QUEUE_LIMIT}){o.queue.push(e.data)}};` +
    // 内联脚本自己不重连：连失败就把字段摘掉，hook 到点了当没早开过，走它自己那套退避
    `var d=function(){if(window.${key}===o){clearTimeout(o.watchdog);delete window.${key}}};` +
    `s.onclose=d;s.onerror=d;` +
    `o.watchdog=setTimeout(function(){if(window.${key}===o){` +
    `try{s.close()}catch(x){}delete window.${key}}},${EARLY_LIVE_SOCKET_WATCHDOG_MS});` +
    `window.${key}=o}}catch(x){}`
  );
}
