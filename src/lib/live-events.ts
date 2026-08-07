import type { DesktopPayload, MusicPayload } from "@/lib/types";

/**
 * 服务端 → 浏览器的实时事件总线。
 *
 * 只做进程内扇出：遥测入口收到上报后 publish，所有打开着的 SSE 连接立刻拿到。
 * 浏览器不需要往回发任何东西，所以这里是单向的。
 *
 * 多实例扩展点：事件在收到 POST 的那个进程里产生，但连接可能挂在别的进程上。
 * 要跨实例的话，在 publish 里补一次 `redis.publish`，再用一条**独立的**订阅连接
 * （ioredis 进入 subscribe 模式后不能再发普通命令，不能复用 lib/redis 那个）
 * 把收到的消息喂回 dispatch。dispatch 已经和 publish 分开了，就是留给这个用的。
 */

/**
 * 前台应用和播放拆成独立事件；Emby 则只发失效通知，由浏览器重取组合状态。
 * 播放来源可能是 MacBook 也可能是 HomePod，和「Mac 正在使用的应用」无关。
 */
export type LiveEvent =
  | { type: "desktop"; payload: DesktopPayload }
  | { type: "music"; payload: MusicPayload }
  /**
   * 只在插拔、换设备这类结构性变化时发，不跟功率/电压/电流的滚动走 ——
   * 那些量充电时每个上报周期都在变，推它们等于把 SSE 当轮询用。
   * 滚动读数仍由卡片自己的 SWR 轮询负责。
   *
   * 和 watching 一样只发失效通知、不带数据：充电头那个 fetcher 是有状态的
   * （组件里用 ref 累积曲线，靠 ?since= 增量拉），直接把 payload 塞进缓存会
   * 绕过那个 ref，下一轮的 since 就基于陈旧的 ref 算，曲线会错位。
   */
  | { type: "charger"; payload: null }
  /**
   * 上报器上下线。只发失效通知 —— 存活是服务端的判断，各卡片重取自己的接口
   * 时会顺带拿到新的 stale，不必在这里把四份 payload 都算一遍推出去。
   *
   * 单独成一种事件，而不是借 desktop / music 推：前端要能分清「上报器离线了」
   * 和「前台应用变了」，而且需要知道离线的不止那两张卡。
   */
  | { type: "presence"; payload: null }
  | { type: "watching"; payload: null };

type Subscriber = (event: LiveEvent) => void;

const subscribers = new Set<Subscriber>();

/** 只往本进程的订阅者投递，不再触发 publish —— 跨实例接入时从这里进来 */
function dispatch(event: LiveEvent) {
  // 复制一份再遍历：投递过程中可能有连接断开并 unsubscribe
  for (const subscriber of [...subscribers]) {
    try {
      subscriber(event);
    } catch (error) {
      // 单个连接写失败不能影响其他连接
      console.error("[live]", error instanceof Error ? error.message : String(error));
    }
  }
}

export function publish(event: LiveEvent) {
  dispatch(event);
}

/** 返回退订函数 */
export function subscribe(subscriber: Subscriber): () => void {
  subscribers.add(subscriber);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    subscribers.delete(subscriber);
  };
}
