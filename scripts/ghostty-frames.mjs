#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "src/lib/ghostty-frames.json");
const SOURCE_URL = "https://ghostty.org/";

const SOURCE_FRAME_MS = 31;
const STRIDE = 3;
const COLUMNS_PER_CELL = 2;
const CELL_ASPECT = 0.91;
const CROP = { left: 12, right: 90, top: 1, bottom: 40 };

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
