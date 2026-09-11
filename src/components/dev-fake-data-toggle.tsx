"use client";

import { useCallback, useEffect, useState } from "react";
import { mutate } from "swr";

import { DevToggle, DevToggleSlot, isDev } from "@/components/dev-toggles";
import { backendUrl } from "@/lib/backend-url";

/**
 * 「假数据」总开关：一键让本地 Worker 用 / 不用注入的夹具（见 workers/api 的
 * DEV_OVERRIDES）。关掉不删夹具，只是暂时不生效，再点回来就都在。
 *
 * 只有后端真是开了 DEV_OVERRIDES 的本地 Worker 时才出现：挂载后问一次
 * /api/dev/overrides，生产 Worker 回 404、没开开关的本地回 404，都不画。
 * 切换后把所有 SWR 键一起重新拉，各张卡当场切过去，不用等下一轮轮询。
 */
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
        // 不是本地 Worker，或者没开：不画
      }
    })();
    return () => controller.abort();
  }, []);

  const toggle = useCallback(async () => {
    if (!state) return;
    const enabled = !state.enabled;
    // POST 而不是 PUT：Worker 的 CORS 只放行 GET / POST，两种 public-api 都收
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
