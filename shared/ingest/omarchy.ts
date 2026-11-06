import { IMAGE_OBJECT_KEY } from "@shared/asset-url";
import { INGEST_FUTURE_SKEW_MS } from "@shared/freshness";
import { object } from "@shared/json";
import type { OmarchyDesktop, OmarchyPresence } from "@shared/omarchy";

import { hasStoredImage, type ImageBucket } from "./r2-assets";

export type PreparedOmarchyReport = { source: "omarchy"; receivedAt: number; presence: OmarchyPresence };

function text(value: unknown, max: number): string | null {
  if (value != null && typeof value !== "string") throw new Error("Omarchy 字段必须是字符串或 null");
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const points = [...trimmed];
  return points.length > max ? points.slice(0, max).join("") : trimmed;
}

async function desktop(value: unknown, images: ImageBucket): Promise<OmarchyDesktop | null> {
  if (value === null) return null;
  const row = object(value);
  const applicationName = text(row?.applicationName, 128);
  if (!row || !applicationName) throw new Error("desktop 缺少 applicationName");
  const iconHash = text(row.iconHash, 64);
  if (iconHash != null && !/^[a-f0-9]{64}$/.test(iconHash)) throw new Error("desktop.iconHash 必须是 SHA-256 十六进制字符串");
  const iconObjectKey = text(row.iconObjectKey, 80);
  if (iconObjectKey != null && (!IMAGE_OBJECT_KEY.test(iconObjectKey) || iconHash == null)) {
    throw new Error("desktop.iconObjectKey 必须是 <sha256>.<ext> 且和 iconHash 一起上报");
  }
  return {
    applicationName,
    appId: text(row.appId, 256),
    windowTitle: text(row.windowTitle, 200),
    workspace: text(row.workspace, 64),
    iconHash,
    // 桶里查不到就当还没传：上报器传完会带着键再报一次。
    iconObjectKey: iconObjectKey && await hasStoredImage(images, iconObjectKey) ? iconObjectKey : null,
  };
}

export async function prepareOmarchyReport(
  input: unknown,
  receivedAt: number,
  images: ImageBucket,
): Promise<PreparedOmarchyReport> {
  const envelope = object(input);
  const modules = object(envelope?.modules);
  const observedAt = envelope?.observedAt;
  if (envelope?.version !== 1 || !modules || !("desktop" in modules)
    || typeof observedAt !== "number" || !Number.isSafeInteger(observedAt) || observedAt <= 0
    || observedAt > receivedAt + INGEST_FUTURE_SKEW_MS) {
    throw new Error("Invalid Omarchy envelope");
  }
  return { source: "omarchy", receivedAt, presence: { observedAt, receivedAt, desktop: await desktop(modules.desktop, images) } };
}
