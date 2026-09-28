/**
 * 推送那条 WebSocket 的早开通道。
 *
 * 不早开的话，它要等整棵树 hydrate 完才由 `useLiveEvents` 的 effect 发起 ——
 * 线上实测：JS chunk 25ms 就开始下、347ms 全部到齐，而第一个 effect 里的请求
 * 878ms 才发出，中间 530ms 全是 hydration。连接本身再花 250ms 上下（WebSocket
 * 不复用已有的 HTTP 连接，DNS/TCP/TLS 都得重来一遍），于是页脚的在线人数比所有
 * 卡片的数据都晚到，那个点要到 1.1s 之后才变绿。
 *
 * 所以把 `new WebSocket()` 挪到 `<head>` 的内联脚本里，30ms 就起手，等 hydration
 * 结束时连接早就开好，`useLiveEvents` 直接接手（adoptEarlySocket）。内联脚本只负责
 * 「开一条、把收到的消息原样攒下」，心跳、重连、可见性全部仍归 hook，两边靠
 * window 上这一个字段交接。攒下的消息交接时按顺序重放：人数（房间在连上的瞬间
 * 就发一条）和 hydration 期间推来的卡片事件都不丢。
 */

/** 内联脚本把连接挂在 window 的这个字段上，hook 从同一个字段取走。 */
export const EARLY_LIVE_SOCKET_KEY = "__lyjwLiveSocket" as const;

export type EarlyLiveSocket = {
  socket: WebSocket;
  /** 交接前收到的原始消息，按到达顺序 */
  queue: string[];
  /** 没人接手时自毁的定时器，hook 接手后清掉 */
  watchdog?: number;
};

declare global {
  interface Window {
    __lyjwLiveSocket?: EarlyLiveSocket;
  }
}

/**
 * 没人来接手就自己关掉的时限。
 *
 * 页面脚本整个崩掉时，这条连接会一直挂着 —— 它不发心跳，还带着「可见」的标记，
 * 房间要等 VISIBLE_STALE_MS（90 秒）加一轮清扫（30 秒）才不数它，人数虚高最长
 * 两分钟，而两处调频上报（采集 Worker 的 PlayStation、agents-reporter）正是按这个
 * 数定节奏的。hydration 超过 15 秒基本等于页面已经废了，这时宁可断开重来。
 */
export const EARLY_LIVE_SOCKET_WATCHDOG_MS = 15_000;

/** 攒消息的上限：hydration 期间正常只有一两条，防的是页面卡死时无限增长 */
export const EARLY_LIVE_SOCKET_QUEUE_LIMIT = 50;

/**
 * 生成 `<head>` 里那段内联脚本。`url` 是不带参数的 `/ws`，可见性参数在这里拼 ——
 * 脚本只在页面可见时起手，所以永远是 `visible=1`。
 *
 * 写成 ES5 的样子（var / function / try-catch），和同在 head 里的主题脚本一致：
 * 这段在任何 polyfill 之前跑，语法层面越保守越好。
 *
 * `url` 已经由 workerUrl 校验过协议和形状，这里只做 JSON 转义，外加把 `<` 转成
 * `<` —— 走的是 dangerouslySetInnerHTML，得保证字符串里不可能冒出 `</script>`。
 */
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
