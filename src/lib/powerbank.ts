import { getStored, lastPushReceivedAt } from "@/lib/powerbank-store";
import { offlineByLiveness, readLiveness, withPresence } from "@/lib/reporter-liveness";
import type { PowerBankPayload, PowerBankPort, PowerBankStatus } from "@/lib/types";

/**
 * Anker Prime 充电宝（A110G）遥测。
 *
 * 和充电头同一条来路：Mac 上报器把 BLE 解出来的数据放进 `chargingDevices`
 * 列表，本站按 `kind` 挑。这里只负责把那份负载归一成卡片要的形状。
 *
 * 和充电头的差别都在语义上，形状是故意做得像的：
 *
 * - **端口是双向的**。C1/C2 既能进电也能出电，所以每个口带 `direction`。
 * - **不上报插了什么设备**。充电头会给 VID/PID，这台固件不给，所以没有
 *   `device` 字段 —— 别在卡片上留一个永远是 Unknown 的位置。
 * - **空闲口的读数是过期的**。固件那个功率槽位是粘滞的，端口断开后仍留着上
 *   一次的值。上报器已经在源头置空，这里再兜一次，免得换个上报器就出错数。
 */

/** 充电宝额定总输出，用来算功率条比例 */
const MAX_OUTPUT_POWER = 220;
/** 电量条按满格 100% 算 */
export const POWER_BANK_MAX_OUTPUT = MAX_OUTPUT_POWER;

/** 上报器 `chargingDevices.devices[]` 里 kind 为 powerBank 的那一台 */
type RawPort = {
  name?: string;
  active?: boolean;
  direction?: string | null;
  voltageV?: number | null;
  currentA?: number | null;
  powerW?: number | null;
  attached?: boolean | null;
};

export type RawPowerBank = {
  id?: string;
  kind?: string;
  connected?: boolean;
  updatedAt?: number;
  firmware?: string | null;
  totalInputW?: number | null;
  totalOutputW?: number | null;
  battery?: {
    percent?: number | null;
    charging?: boolean | null;
    timeToFullMinutes?: number | null;
    thermalLimited?: boolean | null;
  } | null;
  temperaturesC?: number[] | null;
  ports?: RawPort[];
};

const PORT_IDS = ["C1", "C2", "A", "B"] as const;

function displayText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizePort(id: string, port: RawPort = {}): PowerBankPort {
  const active = Boolean(port.active);
  const direction = port.direction === "in" || port.direction === "out" ? port.direction : null;
  return {
    id,
    active,
    direction: active ? direction : null,
    attached: Boolean(port.attached),
    // 不活跃的口不给读数 —— 固件那个槽位是粘滞的，照原样画出来就是几分钟前的数
    power: active ? Number(port.powerW) || 0 : null,
    voltage: active ? Number(port.voltageV) || 0 : null,
    current: active ? Number(port.currentA) || 0 : null,
  };
}

/** 上游给的是秒（带小数），转成 JS 毫秒 */
function toMillis(updatedAt: number | undefined): number | null {
  if (updatedAt == null || Number.isNaN(Number(updatedAt))) return null;
  const value = Number(updatedAt);
  return value > 1e12 ? value : value * 1000;
}

export function pickPowerBank(devices: unknown): RawPowerBank | null {
  if (!devices || typeof devices !== "object") return null;
  const list = (devices as { devices?: unknown }).devices;
  if (!Array.isArray(list)) return null;
  // 按 kind 认，不按下标 —— 那个顺序取决于上报器里链路怎么排，不是契约的一部分
  return (list as RawPowerBank[]).find((device) => device?.kind === "powerBank") ?? null;
}

export function normalizePowerBank(raw: RawPowerBank): PowerBankStatus {
  const byName = new Map(
    (raw.ports ?? []).map((port) => [String(port.name ?? "").toUpperCase().trim(), port]),
  );
  const temperatures = (raw.temperaturesC ?? []).filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  return {
    connected: Boolean(raw.connected),
    battery: raw.battery?.percent ?? null,
    charging: Boolean(raw.battery?.charging),
    timeToFullMinutes: raw.battery?.timeToFullMinutes ?? null,
    thermalLimited: Boolean(raw.battery?.thermalLimited),
    inputPower: Number(raw.totalInputW) || 0,
    outputPower: Number(raw.totalOutputW) || 0,
    temperatures,
    ports: PORT_IDS.map((id) => normalizePort(id, byName.get(id))),
    device: {
      serialNumber: displayText(raw.id),
      firmwareVersion: displayText(raw.firmware),
    },
    updatedAt: toMillis(raw.updatedAt),
  } satisfies PowerBankStatus;
}

/** 默认 90 秒；上报间隔配得更长时按 3 倍加长，不能短于默认。 */
export function powerBankStaleAfterMs() {
  const interval = Number(process.env.CHARGER_PUSH_INTERVAL_MS) || 30_000;
  return Math.max(90_000, interval * 3);
}

/**
 * 和充电头同一套收卡口径：上报器离线，或者太久没推，就把 connected 打成 false。
 * 卡片只看这个字段，不在浏览器再算一遍过期。
 */
export function withPowerBankFreshness(
  payload: PowerBankPayload,
  now = Date.now(),
): PowerBankPayload {
  const stale =
    offlineByLiveness(payload) || now - payload.pushedAt > payload.staleAfterMs;
  return { ...payload, connected: stale ? false : payload.connected };
}

export async function getPowerBankSnapshot(): Promise<PowerBankPayload> {
  const stored = await getStored();
  // 还没收到过任何推送。交给 statusRoute 变成降级信封，前端显示提示
  if (!stored) throw new Error("尚未收到充电宝遥测推送");

  const [pushedAt, live] = await Promise.all([lastPushReceivedAt(), readLiveness()]);

  return withPresence(
    { ...stored.status, pushedAt, staleAfterMs: powerBankStaleAfterMs() } as PowerBankPayload,
    live,
  );
}
