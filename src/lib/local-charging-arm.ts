/**
 * 本机充电 SSE 的开关。
 *
 * 卡片自己不连 127.0.0.1。打开 `LOCAL_CHARGING_PATH` 才往 localStorage
 * 写一条记录，这台浏览器以后进首页才会去连。
 *
 * 读写函数只在客户端调。路径和键名给触发页的内联脚本用，不必把
 * EventSource 那摊拖进服务端包。
 */
export const LOCAL_CHARGING_PATH = "/local/charging";
export const LOCAL_CHARGING_STORAGE_KEY = "local-charging";

export function readLocalChargingArmed(): boolean {
  try {
    return localStorage.getItem(LOCAL_CHARGING_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
