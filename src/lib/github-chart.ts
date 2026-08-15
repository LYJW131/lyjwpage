import { cacheLife } from "next/cache";

import { compactGithubChartSvg, withViewBox } from "@/lib/github-chart-compact";
import { site } from "@/lib/site";

const GITHUB_CHART_URL = `https://ghchart.rshah.org/2563eb/${site.githubLogin}`;

/**
 * 获取 GitHub 提交记录热力图 SVG。
 * 纯服务端请求，通过 'use cache' 缓存在服务端，构建 / 预渲染时直接烧进 HTML，
 * 浏览器端零网络请求、不启动任何客户端轮询。
 *
 * 烧进 HTML 就意味着 RSC 会连着 flight payload 一起算两遍，所以拿到手先压一道
 * （见 github-chart-compact）：54 KB 的 371 个 rect 变成 7 KB 的 5 条 path。
 */
export async function getGithubChartSvg(): Promise<string | null> {
  try {
    const res = await fetch(GITHUB_CHART_URL, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const raw = await res.text();
    if (!raw.includes("<svg")) return null;

    return compactGithubChartSvg(raw) ?? withViewBox(raw);
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
