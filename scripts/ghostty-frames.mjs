#!/usr/bin/env node
/**
 * 从 ghostty.org 首页抓那只 ASCII 幽灵的动画，压成页头图标用的粗网格，
 * 写入 src/lib/ghostty-frames.json（页头前台应用是 Ghostty 时由
 * src/components/live/ghostty-mascot.tsx 播放）。
 *
 * 官网把 235 帧直接内联在首页的 RSC 载荷里（terminalData）：每帧 41 行 × 100 列
 * 终端字符，蓝色光环用 <span class="b"> 标出，每帧 31ms，rAF 循环播放。
 * 24px 的图标里看不清单个字符，这里只保留轮廓和明暗：
 *   1. 每 2 列 × 1 行并成一个单元（JetBrains Mono 的字符格约 6×13px，两列拼起来接近正方）；
 *   2. 按字形墨量把单元量化成本体 3 档 / 光环 3 档 / 空白，共 7 种符号；
 *   3. 裁掉四周空白（列 12–89、行 1–39 → 39×39），每 3 帧取 1 帧（93ms），逐行游程编码。
 *
 * 用法：node scripts/ghostty-frames.mjs            # 抓线上首页
 *      node scripts/ghostty-frames.mjs --from a.html   # 用已下载的首页 HTML
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "src/lib/ghostty-frames.json");
const SOURCE_URL = "https://ghostty.org/";

const SOURCE_FRAME_MS = 31;
const STRIDE = 3;
const COLUMNS_PER_CELL = 2;
/** 单元宽高比：两列字符（2 × 0.6em）对一行（JetBrains Mono 默认行高约 1.32em） */
const CELL_ASPECT = 0.91;
/** 裁剪范围（源网格坐标，右 / 下为开区间），生成时会校验没有字符落在框外 */
const CROP = { left: 12, right: 90, top: 1, bottom: 40 };

/** 各字形的墨量估计（0–1），只用来分档，不追求精确 */
const INK = { " ": 0, "·": 0.08, "~": 0.18, "=": 0.22, "+": 0.28, x: 0.32, o: 0.38, "*": 0.42, "%": 0.6, "@": 0.75, $: 0.9 };
const LEVELS = {
  "#": { fill: "body", opacity: 1 },
  "+": { fill: "body", opacity: 0.6 },
  "-": { fill: "body", opacity: 0.3 },
  B: { fill: "glow", opacity: 1 },
  b: { fill: "glow", opacity: 0.6 },
  ".": { fill: "glow", opacity: 0.3 },
};

function symbolOf(body, glow) {
  if (body >= 0.7) return "#";
  if (body >= 0.35) return "+";
  if (body > 0) return "-";
  if (glow >= 0.35) return "B";
  if (glow >= 0.18) return "b";
  if (glow > 0) return ".";
  return " ";
}

async function loadHtml() {
  const fromIndex = process.argv.indexOf("--from");
  if (fromIndex >= 0) return fs.readFileSync(process.argv[fromIndex + 1], "utf8");
  const response = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`GET ${SOURCE_URL} → HTTP ${response.status}`);
  return response.text();
}

/** 首页 HTML 里 self.__next_f.push([1,"…"]) 的字符串拼起来就是 RSC flight 载荷 */
function extractTerminalData(html) {
  const pushes = html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g);
  const flight = Array.from(pushes, (match) => JSON.parse(match[1])).join("");
  const at = flight.indexOf("terminalData");
  if (at < 0) throw new Error("首页载荷里没找到 terminalData，官网结构可能变了");
  const lineStart = flight.lastIndexOf("\n", at) + 1;
  const lineEnd = flight.indexOf("\n", at);
  const line = flight.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
  const node = JSON.parse(line.slice(line.indexOf(":") + 1));
  const find = (value) => {
    if (!value || typeof value !== "object") return null;
    if (!Array.isArray(value) && value.terminalData) return value.terminalData;
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      const found = find(child);
      if (found) return found;
    }
    return null;
  };
  const data = find(node);
  if (!data) throw new Error("terminalData 解析失败");
  return data;
}

/** 一行 HTML → [{ ch, glow }]，只认 <span class="b"> 和少数实体 */
function parseLine(line) {
  const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };
  const cells = [];
  let glow = false;
  for (let i = 0; i < line.length; ) {
    if (line.startsWith('<span class="b">', i)) {
      glow = true;
      i += 16;
    } else if (line.startsWith("</span>", i)) {
      glow = false;
      i += 7;
    } else if (line[i] === "&") {
      const end = line.indexOf(";", i);
      const entity = line.slice(i, end + 1);
      if (!(entity in ENTITIES)) throw new Error(`未知实体 ${entity}`);
      cells.push({ ch: ENTITIES[entity], glow });
      i = end + 1;
    } else {
      cells.push({ ch: line[i], glow });
      i += 1;
    }
  }
  return cells;
}

function quantize(frame) {
  const rows = [];
  for (let y = CROP.top; y < CROP.bottom; y++) {
    let row = "";
    for (let x = CROP.left; x < CROP.right; x += COLUMNS_PER_CELL) {
      let body = 0;
      let glow = 0;
      for (let dx = 0; dx < COLUMNS_PER_CELL; dx++) {
        const cell = frame[y][x + dx];
        if (!(cell.ch in INK)) throw new Error(`未登记的字符 ${JSON.stringify(cell.ch)}`);
        if (cell.glow) glow += INK[cell.ch];
        else body += INK[cell.ch];
      }
      row += symbolOf(body / COLUMNS_PER_CELL, glow / COLUMNS_PER_CELL);
    }
    rows.push(row);
  }
  return rows;
}

/** 逐行游程编码：`3#` 表示连续 3 个 `#`，单个不写计数；行之间用 `/` 分隔 */
function encode(rows) {
  return rows
    .map((row) => {
      let out = "";
      for (let i = 0; i < row.length; ) {
        let j = i;
        while (row[j] === row[i]) j += 1;
        out += (j - i > 1 ? j - i : "") + row[i];
        i = j;
      }
      return out;
    })
    .join("/");
}

const terminalData = extractTerminalData(await loadHtml());
const frames = Object.keys(terminalData)
  .sort()
  .map((key) => terminalData[key].map(parseLine));

const rowCount = frames[0].length;
const columnCount = frames[0][0].length;
for (const frame of frames) {
  frame.forEach((row, y) => {
    if (row.length !== columnCount) throw new Error(`第 ${y} 行宽度 ${row.length} ≠ ${columnCount}`);
    row.forEach((cell, x) => {
      const inside = y >= CROP.top && y < CROP.bottom && x >= CROP.left && x < CROP.right;
      if (cell.ch !== " " && !inside) throw new Error(`字符落在裁剪框外：行 ${y} 列 ${x}`);
    });
  });
}

const sampled = frames.filter((_, index) => index % STRIDE === 0).map((frame) => encode(quantize(frame)));
const output = {
  columns: (CROP.right - CROP.left) / COLUMNS_PER_CELL,
  rows: CROP.bottom - CROP.top,
  cellAspect: CELL_ASPECT,
  frameMs: SOURCE_FRAME_MS * STRIDE,
  levels: LEVELS,
  frames: sampled,
};
const json = `${JSON.stringify({ ...output, frames: undefined }, null, 1).replace(/\n}$/, "")},\n "frames": [\n${sampled
  .map((frame) => `  ${JSON.stringify(frame)}`)
  .join(",\n")}\n ]\n}\n`;
fs.writeFileSync(OUT, json);
console.error(
  `源 ${frames.length} 帧 ${columnCount}×${rowCount} → ${sampled.length} 帧 ${output.columns}×${output.rows}，` +
    `每帧 ${output.frameMs}ms，${path.relative(ROOT, OUT)} ${Buffer.byteLength(json)} 字节`,
);
