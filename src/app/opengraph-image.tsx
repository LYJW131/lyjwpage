
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { cacheLife } from "next/cache";
import { ImageResponse } from "next/og";

import { githubAvatarPng, pngResponse } from "@/lib/github-avatar-icon";
import { site } from "@/lib/site";

export const alt = `${site.name} — live status of devices, music, media and AI coding`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Turbopack 会把 require.resolve 改成虚拟路径；追踪也要求完整字面量路径。
// pnpm 软链不会自动带入函数，须在 next.config 的 outputFileTracingIncludes 保留这两条路径。
// 不提到模块作用域：Next 读取图片 metadata 时也会导入此模块，字体读取失败会拖垮首页。
function monoFonts() {
  return Promise.all([
    readFile(join(process.cwd(), "node_modules/geist/dist/fonts/geist-mono/GeistMono-Regular.ttf")),
    readFile(join(process.cwd(), "node_modules/geist/dist/fonts/geist-mono/GeistMono-Bold.ttf")),
  ]);
}

const LABELS = "DESKTOP · ACTIVITY · MUSIC · MEDIA · PLAYSTATION · VIBE CODING";

// satori 不支持 oklch。
const PAPER = "#edebe6";
const SURFACE = "#fffdf9";
const INK = "#151411";
const MUTED = "#605d59";
const LINE = "rgba(21,20,17,0.24)";
const PAPER_SHADOW = "rgba(21,20,17,0.18)";
const LIVE = "#3ba946";

const AVATAR_PX = 184;

// Response 不可序列化进 use cache，只缓存图片字节。
async function ogPng(): Promise<Uint8Array> {
  "use cache";
  cacheLife("max");

  const [avatar, [monoRegular, monoBold]] = await Promise.all([
    githubAvatarPng(AVATAR_PX),
    monoFonts(),
  ]);

  const image = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          padding: 40,
          backgroundColor: PAPER,
          fontFamily: "Geist Mono",
        }}
      >
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: 56,
            backgroundColor: SURFACE,
            border: `2px solid ${LINE}`,
            boxShadow: `6px 6px 0 ${PAPER_SHADOW}`,
            color: INK,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: 24,
              letterSpacing: "0.18em",
              color: MUTED,
            }}
          >
            <div style={{ display: "flex" }}>{new URL(site.url).host.toUpperCase()}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div
                style={{ width: 14, height: 14, borderRadius: 9999, backgroundColor: LIVE }}
              />
              <div style={{ display: "flex" }}>LIVE</div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 44 }}>
            <img
              src={`data:image/png;base64,${Buffer.from(avatar).toString("base64")}`}
              alt=""
              width={AVATAR_PX}
              height={AVATAR_PX}
              style={{ border: `2px solid ${LINE}` }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              <div style={{ fontSize: 72, fontWeight: 700, letterSpacing: "-0.03em" }}>
                {site.name}
              </div>
              <div style={{ fontSize: 26, color: MUTED }}>
                {site.repo.replace("https://", "")}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <div
              style={{
                display: "flex",
                height: 12,
                backgroundImage: `repeating-linear-gradient(315deg, ${LINE} 0, ${LINE} 2px, transparent 0, transparent 50%)`,
                backgroundSize: "12px 12px",
              }}
            />
            <div
              style={{ display: "flex", fontSize: 20, letterSpacing: "0.12em", color: MUTED }}
            >
              {LABELS}
            </div>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Geist Mono", data: monoRegular, weight: 400, style: "normal" },
        { name: "Geist Mono", data: monoBold, weight: 700, style: "normal" },
      ],
    },
  );

  return new Uint8Array(await image.arrayBuffer());
}

export default async function OpengraphImage() {
  return pngResponse(await ogPng(), contentType);
}
