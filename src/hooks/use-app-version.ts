"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { type AppVersionStatus, resolveVersionStatus, servingDeployment } from "@/lib/app-version";
import { commitSha as pageCommit } from "@/lib/build-info";
import { fetchStatus } from "@/lib/status-reads";
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
 * 只在生产部署**真的 READY 之后**才比对：构建中的那一版还没在服务，提前提示
 * 等于让人点刷新拿回同一份旧页面。
 */
export function useAppVersion() {
  const isDev = process.env.NODE_ENV === "development";
  const { data: envelope } = useSWR<StatusResponse<VercelDeploymentsPayload>>(
    VERCEL_DEPLOYMENTS_PATH,
    fetchStatus,
  );

  const vercel = envelope?.ok ? envelope.data : undefined;
  /**
   * 只认已经 READY 的那一版 —— payload 里的 `production` 在构建刚开始时就切过去了，
   * 拿它判定会在部署完成前弹提示。详见 lib/app-version 的 servingDeployment。
   */
  const production = servingDeployment(vercel?.production, vercel?.recent);
  const latestCommit = production?.commit?.sha ?? null;

  const status: AppVersionStatus = useMemo(() => {
    if (isDev) return "unknown";
    return resolveVersionStatus(pageCommit, latestCommit);
  }, [isDev, latestCommit]);

  return { status, latestCommit, pageCommit, production, isDev };
}
