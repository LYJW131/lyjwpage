/**
 * 「此刻在线」那条 WebSocket 的早开通道。
 *
 * 不早开的话，它要等整棵树 hydrate 完才由 `useOnlineCount` 的 effect 发起 ——
 * 线上实测：JS chunk 25ms 就开始下、347ms 全部到齐，而第一个 effect 里的请求
 * 878ms 才发出，中间 530ms 全是 hydration。连接本身再花 250ms 上下（WebSocket
 * 不复用已有的 HTTP 连接，DNS/TCP/TLS 都得重来一遍），于是人数比所有卡片的数据
 * 都晚到，页脚那个点要到 1.1s 之后才变绿。
 *
 * 所以把 `new WebSocket()` 挪到 `<head>` 的内联脚本里，30ms 就起手，等 hydration
 * 结束时连接早就开好、人数也收到了，`useOnlineCount` 直接接手（adoptEarlySocket）。
 * 内联脚本只负责「开一条、把收到的人数记下来」，重连、心跳、可见性全部仍归 hook，
 * 两边靠 window 上这一个字段交接。
 */

/** 内联脚本把连接挂在 window 的这个字段上，hook 从同一个字段取走。 */
export const EARLY_ONLINE_SOCKET_KEY = "__lyjwOnlineSocket" as const;

export type EarlyOnlineSocket = {
  socket: WebSocket;
  /** 交接前收到的最新人数。房间在连上的瞬间就广播一次，所以这个值几乎总是有的 */
  count?: number;
  /** 没人接手时自毁的定时器，hook 接手后清掉 */
  watchdog?: number;
};

declare global {
  interface Window {
    __lyjwOnlineSocket?: EarlyOnlineSocket;
  }
}

/**
 * 没人来接手就自己关掉的时限。
 *
 * 页面脚本整个崩掉时，这条连接会一直挂着 —— 它不发心跳，Worker 那侧要等
 * IDLE_TIMEOUT（90 秒）加一轮清扫（30 秒）才踢掉，人数虚高最长两分钟，而三个
 * 上报器正是按这个数定节奏的。hydration 超过 15 秒基本等于页面已经废了，
 * 这时宁可断开重来。
 */
export const EARLY_ONLINE_SOCKET_WATCHDOG_MS = 15_000;

/**
 * 生成 `<head>` 里那段内联脚本。
 *
 * 写成 ES5 的样子（var / function / try-catch），和同在 head 里的主题脚本一致：
 * 这段在任何 polyfill 之前跑，语法层面越保守越好。
 *
 * `url` 已经由 workerUrl 校验过协议和形状，这里只做 JSON 转义，外加把 `<` 转成
 * `<` —— 走的是 dangerouslySetInnerHTML，得保证字符串里不可能冒出 `</script>`。
 */
export function earlyOnlineSocketScript(url: string): string {
  const target = JSON.stringify(url).replace(/</g, "\\u003c");
  const key = EARLY_ONLINE_SOCKET_KEY;
  return (
    `try{if(document.visibilityState!=="hidden"){` +
    `var s=new WebSocket(${target});` +
    `var o={socket:s};` +
    // 交接前把人数一直覆盖成最新的：hook 接手时读到的永远是最后一条广播
    `s.onmessage=function(e){try{var p=JSON.parse(e.data);` +
    `if(typeof p.online==="number"){o.count=p.online}}catch(x){}};` +
    // 内联脚本自己不重连：连失败就把字段摘掉，hook 到点了当没早开过，走它自己那套退避
    `var d=function(){if(window.${key}===o){clearTimeout(o.watchdog);delete window.${key}}};` +
    `s.onclose=d;s.onerror=d;` +
    `o.watchdog=setTimeout(function(){if(window.${key}===o){` +
    `try{s.close()}catch(x){}delete window.${key}}},${EARLY_ONLINE_SOCKET_WATCHDOG_MS});` +
    `window.${key}=o}}catch(x){}`
  );
}
