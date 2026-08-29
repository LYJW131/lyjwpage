/**
 * 分享出去的那张卡片图：1200×630，画的就是站点自己那张纸片。
 *
 * `twitter:image` 不用另开一个 `twitter-image.tsx`：Next 解析 metadata 时会拿
 * openGraph 的图去补 twitter 那几条（见 resolve-metadata 的 postProcessMetadata），
 * 卡片类型也跟着自动变成 summary_large_image。多一个文件只是多一份一模一样的字节。
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { cacheLife } from "next/cache";
import { ImageResponse } from "next/og";

import { githubAvatarPng, pngResponse } from "@/lib/github-avatar-icon";
import { site } from "@/lib/site";

export const alt = `${site.name} —— 设备、音乐、影视与 AI 编程的实时状态`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * 字体从装好的 geist 包里读：不往仓库塞一份 300KB 的副本，也不在构建期联网取字
 * （和 layout 里不用 next/font/google 是同一个理由）。satori 只吃 ttf/otf/woff，
 * 这个包两种都发，挑 ttf 那份。
 *
 * 直接按项目根拼路径，不走 `require.resolve`：Turbopack 在编译期就把它换成自己
 * 图里的 `[project]/...` 虚拟地址，拿去 readFile 读不出文件。
 *
 * 两条路径各写全，不抽一个目录常量出来：产物追踪只认字面量，写成 `join(dir, 名字)`
 * 它就分不清要哪几个，把整个目录二十份字重（近 3MB）全打进函数。
 */
const [monoRegular, monoBold] = await Promise.all([
  readFile(join(process.cwd(), "node_modules/geist/dist/fonts/geist-mono/GeistMono-Regular.ttf")),
  readFile(join(process.cwd(), "node_modules/geist/dist/fonts/geist-mono/GeistMono-Bold.ttf")),
]);

/**
 * 卡片上一律 Latin 字形：satori 只认这里交给它的字体，而这份包里没有中文。
 * 站名、域名、栏目名本来就都是拉丁字母，中文描述交给 `og:description` 那条 meta，
 * 不画进图里 —— 为了一行小字背一份 CJK 字体不划算。
 */
const LABELS = "DESKTOP · ACTIVITY · MUSIC · MEDIA · PLAYSTATION · VIBE CODING";

/** 取浅色那套 globals.css 的 token，算成 sRGB：satori 不认 oklch。 */
const PAPER = "#edebe6"; // --background
const SURFACE = "#fffdf9"; // --surface
const INK = "#151411"; // --foreground
const MUTED = "#605d59"; // --muted-foreground
const LINE = "rgba(21,20,17,0.24)"; // --line
const PAPER_SHADOW = "rgba(21,20,17,0.18)"; // --paper-shadow
const LIVE = "#3ba946"; // --live

/** 头像的实际像素就是画上去的尺寸，图是 1:1 渲染的，不用再乘倍率。 */
const AVATAR_PX = 184;

/**
 * 渲染一次就够：这张图里没有一处随请求变的东西，`cacheLife("max")` 让它跟着
 * 部署冻住 —— 不然每个抓预览的爬虫都要重跑一遍 satori。缓存的是字节而不是
 * Response：Response 不进缓存，头像那两路也是这么分的（见 lib/github-avatar-icon）。
 */
async function ogPng(): Promise<Uint8Array> {
  "use cache";
  cacheLife("max");

  const avatar = await githubAvatarPng(AVATAR_PX);

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
        {/* 站点由一张张硬边纸片拼成，分享卡片就画成其中最大的那一张：方角、墨线描边、
            印刷错位般的硬阴影。线宽和位移按图的倍率各放大一档（站点上是 1px / 3px），
            1px 的线在缩略图里会整条消失。 */}
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
            {/* satori 只认 <img> 和 data URI，next/image 那套在这里没有意义 */}
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
            {/* 站点里 section 之间那道 45° 斜纹（globals.css 的 stripe-divider），
                同样按图的倍率把纹距放大一档 */}
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
