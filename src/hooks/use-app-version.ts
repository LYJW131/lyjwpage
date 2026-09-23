"use client";

import { useMemo } from "react";
import useSWR from "swr";

import {
  APP_VERSION_PATH,
  type AppVersionPayload,
  type AppVersionStatus,
  resolveVersionStatus,
} from "@/lib/app-version";
import { commitSha as pageCommit } from "@/lib/build-info";
import { fetchStatus } from "@/lib/status-reads";
import { VERCEL_DEPLOYMENTS_PATH } from "@/lib/paths";
import type { StatusResponse } from "@/lib/types";
import type { VercelDeploymentsPayload } from "@/lib/vercel-deployments-types";

/** 五分钟一问，切回页面时再问一次；响应几十字节，是随部署分发的静态文件 */
const REFRESH_MS = 5 * 60_000;

async function fetchVersion(path: string): Promise<AppVersionPayload> {
  // 同源、不走 SWR 的状态读路径；浏览器缓存也不能用，要的就是此刻接管域名的那一版
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}

/**
 * 检测当前页面 HTML 是否落后于此刻接管生产域名的那次部署。
 *
 * `pageCommit` 是这份 HTML 构建时焊死的 commit sha（lib/build-info）；
 * 线上那一版由 `/api/version` 回答（见 app/api/version 为什么问它最准）。
 *
 * 构建耗时部署自己不知道，从 Commit 栏那份部署数据里按 sha 借来展示；那份数据
 * 晚几分钟也不要紧，对不上就不显示，不参与判定。
 */
export function useAppVersion() {
  const isDev = process.env.NODE_ENV === "development";
  const { data: latest } = useSWR<AppVersionPayload>(APP_VERSION_PATH, fetchVersion, {
    refreshInterval: REFRESH_MS,
    revalidateOnFocus: true,
  });
  // 和 Commit 栏共用 SWR 键，不多发请求
  const { data: envelope } = useSWR<StatusResponse<VercelDeploymentsPayload>>(
    VERCEL_DEPLOYMENTS_PATH,
    fetchStatus,
  );

  const latestCommit = latest?.commit ?? null;
  const vercel = envelope?.ok ? envelope.data : undefined;
  const deployment = latestCommit
    ? [vercel?.production, ...(vercel?.recent ?? [])].find((item) => item?.commit?.sha === latestCommit)
    : undefined;

  const status: AppVersionStatus = useMemo(() => {
    if (isDev) return "unknown";
    return resolveVersionStatus(pageCommit, latestCommit);
  }, [isDev, latestCommit]);

  return {
    status,
    latestCommit,
    pageCommit,
    message: latest?.message ?? deployment?.commit?.message ?? null,
    buildDurationMs: deployment?.buildDurationMs ?? null,
    isDev,
  };
}
