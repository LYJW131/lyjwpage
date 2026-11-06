import { mirrorKey } from "@shared/storage";

// 上报器每 60 秒心跳一次；三个间隔没收到就当这台机器不在线。
export const OMARCHY_STALE_MS = 3 * 60_000;

export type OmarchyDesktop = {
  applicationName: string;
  // Wayland app_id / Hyprland 窗口 class，对应 Mac 的 bundleIdentifier。
  appId: string | null;
  windowTitle: string | null;
  workspace: string | null;
  // 同 Mac desktop 模块：iconHash 标识应用图标，iconObjectKey 是已在图片桶里的 `<sha256>.png`；有哈希没键表示还没传上去。
  iconHash: string | null;
  iconObjectKey: string | null;
};

export type OmarchyPresence = {
  observedAt: number;
  receivedAt: number;
  // null 表示当前工作区没有聚焦的窗口。
  desktop: OmarchyDesktop | null;
};

export const omarchyMirror = mirrorKey<OmarchyPresence>(["omarchy", "presence"]);
