import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { getRecentCommits } from "@/lib/github-recent-commits";
import type { SiteAssetMetadata } from "@/lib/site-assets";

import { githubAvatarDataUri, githubAvatarPng, githubAvatarSource } from "./site-assets/avatar";
import { ogPng } from "./site-assets/og";

const OUT_DIR = join(process.cwd(), "public", "site-assets");

async function main() {
  const buildId = process.env.BUILD_TIME ?? process.env.COMMIT_SHA ?? "";
  await mkdir(OUT_DIR, { recursive: true });

  const source = await githubAvatarSource(buildId);

  const [avatarDataUri, recentCommits, og, icon32, icon180, icon192, icon512] =
    await Promise.all([
      githubAvatarDataUri(source),
      getRecentCommits(),
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
