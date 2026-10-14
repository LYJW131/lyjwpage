import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { BUNDLED_MODEL_ICONS, MODEL_ICON_DIR } from "@/lib/model-icon";

import { modelIconMappings } from "./model-icons.mjs";
import { githubAvatarPng, githubAvatarSource } from "./site-assets/avatar";
import { ogPng } from "./site-assets/og";

const OUT_DIR = join(process.cwd(), "public", "site-assets");
const MODEL_ICONS_OUT = join(process.cwd(), "public", MODEL_ICON_DIR);

async function writeModelIcons() {
  const bundled: readonly string[] = BUNDLED_MODEL_ICONS;
  const icons = [...new Set(modelIconMappings().map(({ icon }) => icon))].filter((icon) => !bundled.includes(icon));
  await rm(MODEL_ICONS_OUT, { recursive: true, force: true });
  await mkdir(MODEL_ICONS_OUT, { recursive: true });
  await Promise.all(
    icons.map(async (icon) => {
      const { default: Mono } = (await import(`@lobehub/icons/es/${icon}/components/Mono`)) as { default: ComponentType<{ size: number }> };
      await writeFile(join(MODEL_ICONS_OUT, `${icon}.svg`), renderToStaticMarkup(createElement(Mono, { size: 24 })));
    }),
  );
  return icons.length;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const source = await githubAvatarSource();

  const [modelIcons, og, icon32, icon180, icon192, icon512] = await Promise.all([
    writeModelIcons(),
    githubAvatarPng(source, 184).then((avatar) => ogPng(avatar)),
    githubAvatarPng(source, 32),
    githubAvatarPng(source, 180),
    githubAvatarPng(source, 192),
    githubAvatarPng(source, 512),
  ]);

  await Promise.all([
    writeFile(join(OUT_DIR, "icon.png"), icon32),
    writeFile(join(OUT_DIR, "apple-icon.png"), icon180),
    writeFile(join(OUT_DIR, "icon-192.png"), icon192),
    writeFile(join(OUT_DIR, "icon-512.png"), icon512),
    writeFile(join(OUT_DIR, "opengraph.png"), og),
  ]);

  console.log(`[site-assets] avatar=${source ? "ok" : "fallback"} og=ok model-icons=${modelIcons}`);
}

await main();
