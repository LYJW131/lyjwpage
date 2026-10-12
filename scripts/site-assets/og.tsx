import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { Resvg } from "@resvg/resvg-js";
import satori from "satori";

import { site } from "@shared/site";

export const OG_SIZE = { width: 1200, height: 630 };

function monoFonts() {
  return Promise.all([
    readFile(join(process.cwd(), "node_modules/geist/dist/fonts/geist-mono/GeistMono-Regular.ttf")),
    readFile(join(process.cwd(), "node_modules/geist/dist/fonts/geist-mono/GeistMono-Bold.ttf")),
  ]);
}

const LABELS = "DESKTOP · ACTIVITY · MUSIC · MEDIA · PLAYSTATION · VIBE CODING";

const PAPER = "#edebe6";
const SURFACE = "#fffdf9";
const INK = "#151411";
const MUTED = "#605d59";
const LINE = "rgba(21,20,17,0.24)";
const PAPER_SHADOW = "rgba(21,20,17,0.18)";
const LIVE = "#3ba946";

const AVATAR_PX = 184;

export async function ogPng(avatar: Uint8Array): Promise<Uint8Array> {
  const [monoRegular, monoBold] = await monoFonts();

  const svg = await satori(
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
              style={{
                display: "flex", fontSize: 20, letterSpacing: "0.12em", color: MUTED,
              }}
            >
              {LABELS}
            </div>
          </div>
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [
        { name: "Geist Mono", data: monoRegular, weight: 400, style: "normal" },
        { name: "Geist Mono", data: monoBold, weight: 700, style: "normal" },
      ],
    },
  );

  return new Resvg(svg).render().asPng();
}
