"use client";

import { useMemo } from "react";
import useSWR from "swr";

import {
  APP_VERSION_PATH,
  type AppVersionPayload,
  type AppVersionStatus,
  readDocumentCommit,
  resolveVersionStatus,
} from "@/lib/app-version";
import { useLiveEvents } from "@/hooks/use-live-events";
import { commitSha as pageCommit } from "@/lib/build-info";
import { fetchStatus } from "@/lib/status-reads";
import { SITE_DEPLOYMENTS_PATH } from "@/lib/paths";
import type { StatusResponse } from "@shared/types";
import type { SiteDeploymentsPayload } from "@shared/site-deployments-types";

const REFRESH_MS = 30 * 60_000;
const DOCUMENT_RECHECK_MS = 30_000;
const DOCUMENT_HEAD_MAX_CHARS = 64 * 1024;

async function fetchVersion(path: string): Promise<AppVersionPayload> {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}

// 只读到 sha 所在的头部就断开，首页整份 HTML 很大。
async function fetchDocumentCommit(): Promise<string | null> {
  const response = await fetch(window.location.pathname + window.location.search, {
    cache: "no-store",
    headers: { Accept: "text/html" },
  });
  if (!response.ok || !response.body) throw new Error(`document: ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let html = "";
  try {
    while (html.length < DOCUMENT_HEAD_MAX_CHARS) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      const commit = readDocumentCommit(html);
      if (commit || html.includes("</head>")) return commit;
    }
    return readDocumentCommit(html);
  } finally {
    reader.cancel().catch(() => {});
  }
}

export function useVersionStatus() {
  const isDev = process.env.NODE_ENV === "development";
  useLiveEvents();
  const { data: latest } = useSWR<AppVersionPayload>(APP_VERSION_PATH, fetchVersion, {
    refreshInterval: REFRESH_MS,
    revalidateOnFocus: true,
  });

  const latestCommit = latest?.commit ?? null;
  const pending = !isDev && Boolean(pageCommit && latestCommit && latestCommit !== pageCommit);
  const { data: documentCommit } = useSWR<string | null>(
    pending ? ["document-commit", latestCommit] : null,
    fetchDocumentCommit,
    {
      refreshInterval: (commit) => (commit === latestCommit ? 0 : DOCUMENT_RECHECK_MS),
      revalidateOnFocus: true,
    },
  );

  const status: AppVersionStatus = useMemo(() => {
    if (isDev) return "unknown";
    return resolveVersionStatus(pageCommit, latestCommit, documentCommit);
  }, [isDev, latestCommit, documentCommit]);

  return { status, latestCommit, pageCommit, message: latest?.message ?? null, isDev };
}

export function useAppVersion() {
  const { status, latestCommit, pageCommit: page, message, isDev } = useVersionStatus();
  const { data: envelope } = useSWR<StatusResponse<SiteDeploymentsPayload>>(
    SITE_DEPLOYMENTS_PATH,
    fetchStatus,
  );

  const site = envelope?.ok ? envelope.data : undefined;
  const deployment = latestCommit
    ? [site?.production, ...(site?.recent ?? [])].find((item) => item?.commit?.sha === latestCommit)
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
