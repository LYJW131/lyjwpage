import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { githubAvatarPng, githubAvatarSource } from "./site-assets/avatar";
import { ogPng } from "./site-assets/og";

const OUT_DIR = join(process.cwd(), "public", "site-assets");

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const source = await githubAvatarSource();

  const [og, icon32, icon180, icon192, icon512] = await Promise.all([
    githubAvatarPng(source, 184).then((avatar) => ogPng(avatar)),
    githubAvatarPng(source, 32),
    githubAvatarPng(source, 180),
    githubAvatarPng(source, 192),
    githubAvatarPng(source, 512),
  ]);

  await Promise.all([
    copyFile(
      join(process.cwd(), "node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2"),
      join(OUT_DIR, "GeistMono-Variable.woff2"),
    ),
    writeFile(join(OUT_DIR, "icon.png"), icon32),
    writeFile(join(OUT_DIR, "apple-icon.png"), icon180),
    writeFile(join(OUT_DIR, "icon-192.png"), icon192),
    writeFile(join(OUT_DIR, "icon-512.png"), icon512),
    writeFile(join(OUT_DIR, "opengraph.png"), og),
  ]);

  console.log(`[site-assets] avatar=${source ? "ok" : "fallback"} og=ok`);
}

await main();
