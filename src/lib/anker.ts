import { getStored, lastPushReceivedAt } from "@/lib/charger-store";
import { CHARGER_STALE_MS } from "@/lib/freshness";
import { offlineByLiveness, readLiveness, withPresence } from "@/lib/reporter-liveness";
import type { ChargerPayload, ChargerPort, ChargerStatus } from "@/lib/types";

/**
 * Anker Prime 160W (A2687) 遥测。
 *
 * 数据只有一条来路：Mac 上报器读本机 a2687-telemetry 的 /status，作为
 * `charger` 模块塞进 /api/ingest/mac 的信封。本站不主动轮询 —— 遥测服务在
 * 对方机器上，只在 Tailscale 内可达，本来也拉不到。
 */

const PORT_KEYS = ["C1", "C2", "C3"] as const;
/** Anker Prime 的额定总功率 */
const MAX_POWER = 160;

/**
 * 上报器 `modules.chargingDevices` 里的一台设备。
 *
 * 这个形状是多设备通用的：充电头、充电宝，以后还有别的，公共字段都在顶层，
 * 设备特有的收在子对象里（充电宝的 `battery`、`temperaturesC`）。本站现在只画
 * 充电头，所以下面只声明用得上的部分 —— 充电宝的字段照样会送来，忽略即可。
 *
 * 端口是**数组**不是字典：JSON 对象无序，而且两台设备端口名都不一样
 * （充电头 C1/C2/C3，充电宝 C1/C2/A）。
 */
type RawDevicePort = {
  name?: string;
  active?: boolean;
  /** "in" / "out"。充电头永远是 "out"，充电宝才双向。 */
  direction?: string | null;
  voltageV?: number | null;
  currentA?: number | null;
  powerW?: number | null;
  cable?: string | null;
  chargingInfo?: string | null;
  attachedDevice?: { model?: string | null; vendor?: string | null } | null;
};

export type RawChargingDevice = {
  id?: string;
  /** "charger" / "powerBank"。判别字段，决定这台设备该怎么解读。 */
  kind?: string;
  model?: string | null;
  connected?: boolean;
  updatedAt?: number;
  firmware?: string | null;
  totalInputW?: number | null;
  totalOutputW?: number | null;
  ports?: RawDevicePort[];
};

export type RawChargingDevices = {
  devices?: RawChargingDevice[];
};

/** 空串和纯空白都当没有。上报器那边取不到值时给的就是 null，不再有 "N/A" 占位符 */
function displayText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizePort(id: string, port: RawDevicePort = {}): ChargerPort {
  const active = Boolean(port.active);
  return {
    id,
    active,
    // 没在输出的口，读数没有意义 —— 统一置 null 交给 UI 显示 “闲置”
    voltage: active ? Number(port.voltageV) || 0 : null,
    current: active ? Number(port.currentA) || 0 : null,
    power: active ? Number(port.powerW) || 0 : null,
    device: displayText(port.attachedDevice?.model) ?? displayText(port.attachedDevice?.vendor),
    protocol: displayText(port.chargingInfo),
    cable: displayText(port.cable),
  };
}

/** 上游给的是秒（带小数），转成 JS 毫秒 */
function toMillis(updatedAt: number | undefined): number | null {
  if (updatedAt == null || Number.isNaN(Number(updatedAt))) return null;
  const value = Number(updatedAt);
  return value > 1e12 ? value : value * 1000;
}

/** 把 a2687 的 /status 原样 JSON 规范化 */
/**
 * 从多设备负载里挑出充电头。
 *
 * 上报器现在会同时送充电头和充电宝，本站只画充电头 —— 用 `kind` 认，不要靠
 * 数组顺序，那个顺序取决于上报器里链路的排列，不是契约的一部分。
 *
 * 一台充电头都没有就返回 null（比如用户只开了充电宝模块），调用方按「这次没带
 * 充电头数据」处理，不要当成错误。
 */
export function pickCharger(raw: RawChargingDevices): RawChargingDevice | null {
  return raw.devices?.find((device) => device.kind === "charger") ?? null;
}

export function normalizeChargingDevice(raw: RawChargingDevice): ChargerStatus {
  // 端口按名字取。上报器是按 C1/C2/C3 顺序发的，但顺序不进契约，认名字更稳。
  const byName = new Map(
    (raw.ports ?? []).map((port) => [String(port.name ?? "").toUpperCase(), port]),
  );
  return {
    connected: Boolean(raw.connected),
    totalPower: Number(raw.totalOutputW) || 0,
    maxPower: MAX_POWER,
    ports: PORT_KEYS.map((key) => normalizePort(key, byName.get(key))),
    device: {
      // 新契约里设备身份就是 id，不再嵌一层 device 对象。
      serialNumber: displayText(raw.id),
      firmwareVersion: displayText(raw.firmware),
    },
    updatedAt: toMillis(raw.updatedAt),
  } satisfies ChargerStatus;
}

/** 默认 90 秒；上报间隔配得更长时按 3 倍加长，不能短于默认。 */
export function chargerStaleAfterMs() {
  const interval = Number(process.env.CHARGER_PUSH_INTERVAL_MS) || 30_000;
  return Math.max(CHARGER_STALE_MS, interval * 3);
}

/**
 * 和 main 同一套收卡口径：上报器离线或充电头自己太久没推，就把 connected
 * 打成 false。卡片只看这个字段，不在浏览器再算一遍过期。
 *
 * 快照里留 Redis 原样的 connected；过期是时间函数，在取数出口现盖
 * （首页填缓存、API overlay、推送），不要写进 cachedChargerSnapshot。
 */
export function withChargerFreshness(
  payload: ChargerPayload,
  now = Date.now(),
): ChargerPayload {
  const stale =
    offlineByLiveness(payload) || now - payload.pushedAt > payload.staleAfterMs;
  return {
    ...payload,
    connected: stale ? false : payload.connected,
  };
}

/**
 * `since` 是客户端已有的最新采样点时刻，只回传比它更新的部分。
 *
 * 曲线有 400 个点、约 15KB，而前端 30 秒取一次、每次实际只多出一两个点 ——
 * 整份重传的话 99% 是重复数据。
 *
 * 快照只盖时间戳、不改 connected。过期收卡见 withChargerFreshness。
 */
export async function getChargerSnapshot(): Promise<ChargerPayload> {
  const stored = await getStored();
  // 还没收到过任何推送。交给 statusRoute 变成降级信封，前端显示提示
  if (!stored) throw new Error("尚未收到充电头遥测推送");

  const [pushedAt, live] = await Promise.all([lastPushReceivedAt(), readLiveness()]);

  return withPresence(
    {
      ...stored.status,
      history: stored.history,
      historyPartial: false,
      pushedAt,
      staleAfterMs: chargerStaleAfterMs(),
    },
    live,
  );
}

/** 按客户端游标切历史。不重读 Redis，给缓存命中之后的增量路径用。 */
export function sliceChargerHistory(payload: ChargerPayload, since?: number): ChargerPayload {
  const all = payload.history;
  const oldest = all[0]?.t;
  /**
   * 只有「客户端手上最新的点」不早于「服务端还留着的最旧的点」时，增量才是
   * 连续的。客户端离开太久的话中间那段已经被裁掉了，拼出来会是断的曲线，
   * 这种情况只能整份重发。
   */
  const historyPartial = since != null && oldest != null && since >= oldest;
  return {
    ...payload,
    history: historyPartial ? all.filter((sample) => sample.t > since) : all,
    historyPartial,
  };
}

export async function getChargerPayload(
  { since }: { since?: number } = {},
): Promise<ChargerPayload> {
  return withChargerFreshness(sliceChargerHistory(await getChargerSnapshot(), since));
}
