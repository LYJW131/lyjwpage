import fs from "node:fs";
import path from "node:path";

// @next/env 是 CommonJS 包，ESM 这边只能拿默认导出再解构
import nextEnv from "@next/env";

import { fetchRepoStats, repoIdFromUrl } from "../src/lib/github-repo.ts";
import { site } from "../src/lib/site.ts";

const { loadEnvConfig } = nextEnv;

/**
 * 构建前取一次本仓库的贡献统计，落到 .next/cache；next.config.ts 再把它经
 * `env` 焊成常量。package.json 的 build 脚本先跑它、再跑 `next build`
 * （Vercel 跑的正是 `pnpm run build`）。
 *
 * 为什么不放在 next.config.ts 或页面的 `use cache` 里：
 * - 每次部署本身是一次 push，GitHub 会作废这个仓的统计缓存重新排队现算，
 *   期间一直回 202，一轮从 30 秒到三分钟以上都有；预渲染里填缓存最多等 50 秒。
 * - next.config 会被构建主进程和每个静态生成 worker 各加载一遍，网络等待
 *   放那里等于乘以进程数。
 *
 * 等不到就沿用上一次构建留下的那份（Vercel 在构建之间保留 .next/cache），
 * 统计最多落后一次部署，卡片始终有东西；连上一份也没有才空着。
 */

const CACHE_FILE = path.join(process.cwd(), ".next", "cache", "github-repo-stats.json");

// 和 Next 一样读 .env* 文件，本地才拿得到 GITHUB_TOKEN；Vercel 上直接在环境里。
loadEnvConfig(process.cwd());

const token = process.env.GITHUB_TOKEN?.trim() || null;
const { owner, name } = repoIdFromUrl(site.repo);

try {
  const stats = await fetchRepoStats(token, owner, name);
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(stats));
  console.log(
    `[github-repo] ${stats.repo}：${stats.totals.commits} commits、${stats.totals.contributors} 位贡献者，已写入 ${path.relative(process.cwd(), CACHE_FILE)}`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (fs.existsSync(CACHE_FILE)) {
    console.warn(`[github-repo] ${message}；沿用上一次构建的统计`);
  } else {
    console.warn(`[github-repo] ${message}；没有上一次的统计可用，这次构建不画`);
  }
}
