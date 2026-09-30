"use client";

import { useCallback, useEffect, useState } from "react";
import { mutate } from "swr";

import { DevToggle, DevToggleSlot, isDev } from "@/components/dev-toggles";
import { backendUrl } from "@/lib/backend-url";

const OVERRIDES_PATH = "/api/dev/overrides";

type OverridesState = { enabled: boolean; paths: string[] };

export function DevFakeDataToggle() {
  const [state, setState] = useState<OverridesState | null>(null);

  useEffect(() => {
    if (!isDev) return;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(backendUrl(OVERRIDES_PATH), { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const body = (await response.json()) as Partial<OverridesState> & { ok?: boolean };
        if (body.ok) setState({ enabled: body.enabled !== false, paths: body.paths ?? [] });
      } catch {
      }
    })();
    return () => controller.abort();
  }, []);

  const toggle = useCallback(async () => {
    if (!state) return;
    const enabled = !state.enabled;
    // Worker 的 CORS 不放行 PUT。
    const response = await fetch(backendUrl(OVERRIDES_PATH), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (!response.ok) return;
    setState({ ...state, enabled });
    await mutate(() => true);
  }, [state]);

  if (!state) return null;
  return (
    <DevToggleSlot>
      <DevToggle
        label="Fake data"
        on={state.enabled}
        states={["On", "Off"]}
        onClick={() => void toggle()}
        title={
          state.paths.length
            ? `开发环境调试：切换是否使用注入的假数据（当前注入 ${state.paths.length} 条：${state.paths.join("、")}）`
            : "开发环境调试：切换是否使用注入的假数据（当前没有注入任何端点）"
        }
      />
    </DevToggleSlot>
  );
}
