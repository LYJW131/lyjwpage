import { ingestRoute } from "@/lib/api";
import { invalidate } from "@/lib/cache";
import { clearNowPlaying, setNowPlaying } from "@/lib/emby-store";
import { getNowWatching } from "@/lib/emby";
import { publish } from "@/lib/live-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 接收 Emby 的播放通知（Webhooks）。
 *
 * 在 Emby 后台「通知 → 添加通知 → Webhooks」里填本站地址，勾上播放相关事件。
 * 配好后本站不再轮询 /emby/Sessions。
 *
 * 唯一一个不校验密钥的 ingest 端点：部署时 Emby 和本站在同一个容器网络里直连，
 * 这个路径不对外暴露，所以不需要。别把它挂到公网上。
 */

type Unknown = Record<string, unknown>;

const asRecord = (value: unknown): Unknown | null =>
  value && typeof value === "object" ? (value as Unknown) : null;

const asString = (value: unknown): string =>
  typeof value === "string" ? value : typeof value === "number" ? String(value) : "";

const asNumber = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** 从若干可能的位置里挑第一个有值的 */
function pick(source: Unknown | null, ...names: string[]): unknown {
  if (!source) return undefined;
  for (const name of names) {
    if (source[name] != null) return source[name];
  }
  return undefined;
}

/**
 * Emby 各版本的事件名写法不一致（playback.start / PlaybackStart / playbackstart…），
 * 统一压成小写去掉分隔符再按子串判断，避免和具体写法绑死。
 */
function classify(event: string): "start" | "pause" | "resume" | "stop" | null {
  const e = event.toLowerCase().replace(/[._\-\s]/g, "");
  if (!e.includes("playback") && !e.includes("play")) return null;
  if (e.includes("stop")) return "stop";
  // unpause 里也含 pause，必须先判 unpause
  if (e.includes("unpause") || e.includes("resume")) return "resume";
  if (e.includes("pause")) return "pause";
  if (e.includes("start") || e.includes("progress")) return "start";
  return null;
}

export async function POST(request: Request) {
  // 先原样读出来：出错时要把原文打进日志，对着真实 payload 调字段名
  const text = await request.text();

  return ingestRoute(async () => {
    let body: Unknown;
    try {
      body = JSON.parse(text) as Unknown;
    } catch {
      console.error("[emby-webhook] 请求体不是 JSON:", text.slice(0, 400));
      throw new Error("请求体不是合法 JSON");
    }

    const event = asString(pick(body, "Event", "event", "NotificationType", "Type"));
    const kind = classify(event);

    // 不是播放事件（媒体库更新之类），照收不误但什么都不做 —— 回 4xx 会让 Emby 反复重试
    if (!kind) return { handled: false as const };

    const item = asRecord(pick(body, "Item", "item"));
    const session = asRecord(pick(body, "Session", "session"));
    const playState = asRecord(
      pick(session, "PlayState", "playState") ?? pick(body, "PlayState", "PlaybackInfo"),
    );

    const itemId = asString(pick(item, "Id", "id", "ItemId"));
    if (!itemId) {
      // 结构和预期不符，把原文打出来，方便对着真实 payload 调整
      console.error("[emby-webhook] 取不到 Item.Id，原始 payload:", text.slice(0, 1200));
      throw new Error("payload 里没有 Item.Id");
    }

    // 播放会改变续播列表和当前会话的位置，让下一次状态请求全部重新取。
    await invalidate("emby:resume");
    await invalidate("emby:session-position");

    if (kind === "stop") {
      await clearNowPlaying();
    } else {
      await setNowPlaying({
        itemId,
        paused: kind === "pause",
        positionTicks: asNumber(
          pick(playState, "PositionTicks", "positionTicks") ??
            pick(body, "PlaybackPositionTicks"),
        ),
        runTimeTicks: asNumber(pick(item, "RunTimeTicks", "runTimeTicks")),
        device: asString(pick(session, "Client", "DeviceName", "client", "deviceName")),
        at: Date.now(),
      });
    }

    // 状态已持久化后再推给浏览器。直接带数据，不发信号让前端回头再拉一次 ——
    // 这条本来就是 webhook 驱动的，服务端手上已经是最新的了。
    publish({ type: "watching", payload: await getNowWatching() });

    return { handled: true as const, kind };
  });
}
