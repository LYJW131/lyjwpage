import { ingestRoute } from "@/lib/api";
import { recordPhoneEnvelope } from "@/lib/phone-telemetry";

/**
 * iPhone 遥测中心的唯一入口。信封和模块名见 lib/phone-telemetry。
 *
 * 按**观测数据的那台设备**命名（AGENTS.md 第 1 条）。活动圆环其实是 Apple Watch
 * 采的、Apple 健康汇总的，但搬运和观测它的是这台 iPhone —— 和 `/api/ingest/mac`
 * 一个道理：那边的充电头数据出自 Anker 的充电器，照样走 `mac`，因为观测它的是
 * 那台 Mac。换个上报程序不用改这个 URL。
 *
 * 从前活动圆环走的是 `/api/ingest/apple-health`，那时它是个只报健康的单一用途
 * App。**改了名就是改了，不留旧路由**（AGENTS.md）—— 那条路一次都没部署到生产，
 * 现在是改它最便宜的时刻。
 */
export async function POST(request: Request) {
  return ingestRoute(request, recordPhoneEnvelope);
}
