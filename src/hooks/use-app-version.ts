"use client";

import { useMemo } from "react";
import useSWR from "swr";

import {
  APP_VERSION_PATH,
  type AppVersionPayload,
  type AppVersionStatus,
  resolveVersionStatus,
} from "@/lib/app-version";
import { useLiveEvents } from "@/hooks/use-live-events";
import { commitSha as pageCommit } from "@/lib/build-info";
import { fetchStatus } from "@/lib/status-reads";
import { VERCEL_DEPLOYMENTS_PATH } from "@/lib/paths";
import type { StatusResponse } from "@/lib/types";
import type { VercelDeploymentsPayload } from "@/lib/vercel-deployments-types";

/**
 * 半小时一问只是兜底。打开页面和切回页面时照样各问一次；新部署接管域名后由
 * GitHub Actions 经 Worker 推一条 `version` 通知（hooks/use-live-events），
 * 开着的页面当场重问，不靠这条轮询赶上。
 */
const REFRESH_MS = 30 * 60_000;

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
  // 共用整页那一条连接；`version` 通知靠它送到
  useLiveEvents();
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
