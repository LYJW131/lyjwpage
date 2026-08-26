import type { Metadata } from "next";

import { LOCAL_CHARGING_STORAGE_KEY } from "@/lib/local-charging-arm";

export const metadata: Metadata = {
  title: "本机充电",
  robots: { index: false, follow: false },
};

/**
 * 本机充电 SSE 的开关。浏览器打开这一页：往 localStorage 写一条记录，
 * 再送回首页。卡片看到这条记录才去挂 EventSource。
 *
 * 用内联脚本而不是 client 组件：写存储和跳转都不必等 React 水合，
 * 也不在地址栏里停一下空页。
 */
export default function LocalChargingArmPage() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `try{localStorage.setItem(${JSON.stringify(LOCAL_CHARGING_STORAGE_KEY)},"1")}catch(e){}location.replace("/")`,
      }}
    />
  );
}
