import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { type GithubRecentCommit, getRecentCommits } from "@/lib/github-recent-commits";
import { site } from "@shared/site";
import { SITE_ASSET_METADATA_PATH, type SiteAssetMetadata } from "@/lib/site-assets";

import { githubAvatarDataUri, githubAvatarPng, githubAvatarSource } from "./site-assets/avatar";
import { ogPng } from "./site-assets/og";

const OUT_DIR = join(process.cwd(), "public", "site-assets");

const COMMIT_ATTEMPTS = 3;

// 最近提交只在构建时取一次：GitHub 这一下不可用就沿用线上版本那份，不把空列表固化进本版本直到下次部署。
async function recentCommitsOrLastGood(): Promise<GithubRecentCommit[]> {
  for (let attempt = 1; attempt <= COMMIT_ATTEMPTS; attempt++) {
    const commits = await getRecentCommits();
    if (commits.length) return commits;
    if (attempt < COMMIT_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
  }
  try {
    const response = await fetch(`${site.url}${SITE_ASSET_METADATA_PATH}`, {
      signal: AbortSignal.timeout(8_000),
    });
    const metadata = (await response.json()) as Partial<SiteAssetMetadata>;
    if (response.ok && Array.isArray(metadata.recentCommits)) {
      console.warn("[site-assets] GitHub unavailable, reusing published recent commits");
      return metadata.recentCommits;
    }
  } catch (error) {
    console.warn("[site-assets] published metadata unavailable:", error instanceof Error ? error.message : error);
  }
  return [];
}

async function main() {
  const buildId = process.env.BUILD_TIME ?? process.env.COMMIT_SHA ?? "";
  await mkdir(OUT_DIR, { recursive: true });

  const source = await githubAvatarSource(buildId);

  const [avatarDataUri, recentCommits, og, icon32, icon180, icon192, icon512] =
    await Promise.all([
      githubAvatarDataUri(source),
      recentCommitsOrLastGood(),
      githubAvatarPng(source, 184).then((avatar) => ogPng(avatar)),
      githubAvatarPng(source, 32),
      githubAvatarPng(source, 180),
      githubAvatarPng(source, 192),
      githubAvatarPng(source, 512),
    ]);

  const metadata: SiteAssetMetadata = { avatarDataUri, recentCommits };

  const tasks: Promise<unknown>[] = [
    copyFile(
      join(process.cwd(), "node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2"),
      join(OUT_DIR, "GeistMono-Variable.woff2"),
    ),
    writeFile(join(OUT_DIR, "metadata.json"), JSON.stringify(metadata)),
    writeFile(join(OUT_DIR, "icon.png"), icon32),
    writeFile(join(OUT_DIR, "apple-icon.png"), icon180),
    writeFile(join(OUT_DIR, "icon-192.png"), icon192),
    writeFile(join(OUT_DIR, "icon-512.png"), icon512),
    writeFile(join(OUT_DIR, "opengraph.png"), og),
  ];
  await Promise.all(tasks);

  console.log(
    `[site-assets] avatar=${avatarDataUri ? "ok" : "fallback"} og=ok commits=${recentCommits.length}`,
  );
}

await main();
