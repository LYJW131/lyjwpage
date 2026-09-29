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
 * 只回答「手上这份页面旧不旧」：`/api/version` 加 `version` 推送，不碰部署详情。
 *
 * 自动刷新（hooks/use-stale-auto-reload）和卡片崩溃后的兜底都只要这一句，
 * 不该为此顺带取一份 Vercel 部署列表。SWR 按键去重，和 `useAppVersion` 同时挂着
 * 也只发一份请求。
 *
 * `pageCommit` 是这份 HTML 构建时焊死的 commit sha（lib/build-info）；
 * 线上那一版由 `/api/version` 回答（见 app/api/version 为什么问它最准）。
 */
export function useVersionStatus() {
  const isDev = process.env.NODE_ENV === "development";
  // 共用整页那一条连接；`version` 通知靠它送到
  useLiveEvents();
  const { data: latest } = useSWR<AppVersionPayload>(APP_VERSION_PATH, fetchVersion, {
    refreshInterval: REFRESH_MS,
    revalidateOnFocus: true,
  });

  const latestCommit = latest?.commit ?? null;
  const status: AppVersionStatus = useMemo(() => {
    if (isDev) return "unknown";
    return resolveVersionStatus(pageCommit, latestCommit);
  }, [isDev, latestCommit]);

  return { status, latestCommit, pageCommit, message: latest?.message ?? null, isDev };
}

/**
 * 检测当前页面 HTML 是否落后于此刻接管生产域名的那次部署。
 *
 * 构建耗时部署自己不知道，从 Commit 栏那份部署数据里按 sha 借来展示；那份数据
 * 晚几分钟也不要紧，对不上就不显示，不参与判定。
 */
export function useAppVersion() {
  const { status, latestCommit, pageCommit: page, message, isDev } = useVersionStatus();
  // 和 Commit 栏共用 SWR 键，不多发请求
  const { data: envelope } = useSWR<StatusResponse<VercelDeploymentsPayload>>(
    VERCEL_DEPLOYMENTS_PATH,
    fetchStatus,
  );

  const vercel = envelope?.ok ? envelope.data : undefined;
  const deployment = latestCommit
    ? [vercel?.production, ...(vercel?.recent ?? [])].find((item) => item?.commit?.sha === latestCommit)
    : undefined;

  return {
    status,
    latestCommit,
    pageCommit: page,
    message: message ?? deployment?.commit?.message ?? null,
    buildDurationMs: deployment?.buildDurationMs ?? null,
    isDev,
  };
}
