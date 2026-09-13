"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { type AppVersionStatus, resolveVersionStatus } from "@/lib/app-version";
import { commitSha as pageCommit } from "@/lib/build-info";
import { statusFetcher } from "@/hooks/use-status";
import { VERCEL_DEPLOYMENTS_PATH } from "@/lib/paths";
import type { StatusResponse } from "@/lib/types";
import type { VercelDeploymentsPayload } from "@/lib/vercel-deployments-types";

/**
 * 检测当前页面 HTML 是否落后于生产环境正在运行的版本。
 *
 * `pageCommit` 是这份 HTML 构建时焊死的 commit sha（lib/build-info）。
 * 直接复用 Commit 栏现有的 Vercel 部署状态（/api/status/vercel-deployments），
 * 共享 SWR 缓存，不产生额外的网络请求或新接口。
 *
 * 当 Vercel 生产部署完成、当前线上的 commit sha 发生变化时，如果与
 * 当前页面内联的 commit sha 不一致，则判定为 stale。
 */
export function useAppVersion() {
  const isDev = process.env.NODE_ENV === "development";
  const { data: envelope } = useSWR<StatusResponse<VercelDeploymentsPayload>>(
    VERCEL_DEPLOYMENTS_PATH,
    statusFetcher,
  );

  const vercel = envelope?.ok ? envelope.data : undefined;
  const production = vercel?.production ?? null;
  const latestCommit = production?.commit?.sha ?? null;

  const status: AppVersionStatus = useMemo(() => {
    if (isDev) return "unknown";
    return resolveVersionStatus(pageCommit, latestCommit);
  }, [isDev, latestCommit]);

  return { status, latestCommit, pageCommit, production, isDev };
}
