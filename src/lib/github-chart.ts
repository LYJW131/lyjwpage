import { cacheLife } from "next/cache";

import { site } from "@/lib/site";

const GITHUB_CHART_URL = `https://ghchart.rshah.org/2563eb/${site.githubLogin}`;

/**
 * 获取 GitHub 提交记录热力图 SVG。
 * 纯服务端请求，通过 'use cache' 缓存在服务端，构建 / 预渲染时直接烧进 HTML，
 * 浏览器端零网络请求、不启动任何客户端轮询。
 */
export async function getGithubChartSvg(): Promise<string | null> {
  try {
    const res = await fetch(GITHUB_CHART_URL, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const raw = await res.text();
    if (!raw.includes("<svg")) return null;

    let svg = raw;
    if (!svg.includes("viewBox")) {
      svg = svg.replace(
        /<svg\s+([^>]*?)width="(\d+)"\s+height="(\d+)"([^>]*)>/i,
        (_, before, w, h, after) =>
          `<svg ${before}viewBox="0 0 ${w} ${h}" width="100%" height="auto"${after}>`,
      );
    }
    return svg;
  } catch (error) {
    console.error("[github-chart]", error instanceof Error ? error.message : String(error));
    return null;
  }
}

export async function cachedGithubChart(): Promise<string | null> {
  "use cache";
  cacheLife("hours");
  return getGithubChartSvg();
}
