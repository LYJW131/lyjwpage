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

const REFRESH_MS = 30 * 60_000;

async function fetchVersion(path: string): Promise<AppVersionPayload> {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}

export function useVersionStatus() {
  const isDev = process.env.NODE_ENV === "development";
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

export function useAppVersion() {
  const { status, latestCommit, pageCommit: page, message, isDev } = useVersionStatus();
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
