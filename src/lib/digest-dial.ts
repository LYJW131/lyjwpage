import { scriptJson } from "@/lib/inline-script";

export const DAY_SECONDS = 86_400;
export const SIZE = 200;
export const CENTER = SIZE / 2;
export const TRACK_WIDTH = 9;
export const TICK_OUTER = 5;
export const TICK_INNER = 12;
export const HAND_INNER = 36;
export const HAND_OUTER = CENTER - 4;

export function dayTurn(at: number, offsetSeconds: number) {
  return ((((at / 1000 + offsetSeconds) % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS) / DAY_SECONDS;
}

// workerd 与浏览器的三角函数末位可能不同，不取整会让 SSR 的 path 与水合对不上。
const coordinate = (value: number) => Math.round(value * 100) / 100;

export function polar(radius: number, turn: number) {
  return [coordinate(CENTER + radius * Math.sin(turn * 2 * Math.PI)), coordinate(CENTER - radius * Math.cos(turn * 2 * Math.PI))] as const;
}

export function arc(radius: number, from: number, to: number) {
  const [x0, y0] = polar(radius, from);
  const [x1, y1] = polar(radius, to);
  return `M ${x0} ${y0} A ${radius} ${radius} 0 0 1 ${x1} ${y1}`;
}

const clockFormat = new Map<string, Intl.DateTimeFormat>();

export function clockLabel(now: number, timezone: string) {
  let format = clockFormat.get(timezone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    clockFormat.set(timezone, format);
  }
  return format.format(new Date(now));
}

// 首屏 HTML 按快照时刻画表盘，缓存过的页面会早几分钟；水合要等脚本下载执行完，表盘先显示旧时刻再跳。
// 紧跟表盘的内联脚本在首次绘制前按本机时钟改写文字和指针；水合时 React 认这份不一致（suppressHydrationWarning），挂载后再按此刻重画。
// 取整与 coordinate、格式与 clockLabel 须一致，由 digest-dial.test.mts 跑一遍脚本核对。
export function dialBootScript(timezone: string) {
  return `(()=>{try{const s=document.currentScript.previousElementSibling,p={};for(const x of new Intl.DateTimeFormat("en-GB",{timeZone:${scriptJson(timezone)},hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date()))p[x.type]=x.value;s.querySelector("[data-dial-clock]").textContent=p.hour+":"+p.minute;const a=(p.hour*3600+p.minute*60+ +p.second)/${DAY_SECONDS}*2*Math.PI,h=s.querySelector("[data-dial-hand]"),c=v=>String(Math.round(v*100)/100);h.setAttribute("x1",c(${CENTER}+${HAND_INNER}*Math.sin(a)));h.setAttribute("y1",c(${CENTER}-${HAND_INNER}*Math.cos(a)));h.setAttribute("x2",c(${CENTER}+${HAND_OUTER}*Math.sin(a)));h.setAttribute("y2",c(${CENTER}-${HAND_OUTER}*Math.cos(a)))}catch{}})()`;
}
