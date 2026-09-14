#!/usr/bin/env node
/**
 * 改完 docs/architecture.json 后一条命令出齐所有产物：
 *   1. archify deliver：showcase 校验并渲染 docs/architecture.html
 *   2. 用查看器自带的 PNG 导出（svg-rasterization）重出 docs/architecture-{light,dark}.png，缩到 2x（2780×1780）
 *   3. archify visual-check：四个桌面视口无溢出，随后清掉它写在 docs/ 里的截图与对照表
 *   4. 汇总成 docs/architecture.receipt.json
 *
 * 前置：本机装有 archify 技能（默认 ~/.claude/skills/archify，可用 ARCHIFY_DIR 覆盖）和 Chrome。
 * 用法：
 *   pnpm docs:architecture                 # 全流程
 *   pnpm docs:architecture -- --validate   # 只校验，不写任何文件（改图时反复跑这个）
 *   pnpm docs:architecture -- --skip-visual  # 不跑 visual-check（receipt 里视口沿用上一份）
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = path.join(ROOT, "docs");
const SPEC = path.join(DOCS, "architecture.json");
const HTML = path.join(DOCS, "architecture.html");
const RECEIPT = path.join(DOCS, "architecture.receipt.json");
const ARCHIFY_DIR = process.env.ARCHIFY_DIR ?? path.join(os.homedir(), ".claude/skills/archify");
const ARCHIFY = path.join(ARCHIFY_DIR, "bin/archify.mjs");
const PREVIEW_SCALE = 2; // 快照按 viewBox 的 2x 出，查看器原生导出是 3x，缩一档省体积
const THEMES = ["light", "dark"];

const args = new Set(process.argv.slice(2));
const validateOnly = args.has("--validate");
const skipVisual = args.has("--skip-visual");

if (!fs.existsSync(ARCHIFY)) {
  fail(`找不到 archify：${ARCHIFY}\n把技能装到 ~/.claude/skills/archify，或用 ARCHIFY_DIR 指向它。`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function archify(subcommand, ...rest) {
  const result = spawnSync(
    process.execPath,
    [ARCHIFY, subcommand, ...rest, "--json"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    fail(`archify ${subcommand} 输出不是 JSON：\n${result.stdout}\n${result.stderr}`);
  }
  return { report, status: result.status };
}

function printDiagnostics(report) {
  if (report.error) console.error(report.error);
  for (const d of report.diagnostics ?? []) {
    if (!report.error?.includes(d.message)) console.error(`- ${d.message}`);
  }
}

// 1. 校验 / 交付
const specArgs = ["architecture", SPEC, "--quality", "showcase", "--repo-root", ROOT];
if (validateOnly) {
  const { report } = archify("validate", ...specArgs);
  if (!report.ok) {
    printDiagnostics(report);
    fail("校验未通过。");
  }
  console.log(`校验通过：${report.checks.length} 项检查全部 ok。`);
  process.exit(0);
}

const delivered = archify("deliver", ...specArgs.slice(0, 2), HTML, ...specArgs.slice(2));
if (!delivered.report.ok) {
  printDiagnostics(delivered.report);
  fail("deliver 失败，HTML 未更新。");
}
const { specification, artifact, validation, evidence } = delivered.report;
const viewBox = readJson(SPEC)?.meta?.viewBox;
if (!Array.isArray(viewBox) || viewBox.length !== 2) fail("architecture.json 缺少 meta.viewBox，无法确定快照尺寸。");
const previewSize = viewBox.map((edge) => Math.round(edge * PREVIEW_SCALE));
console.log(`HTML 已渲染：${validation.checksPassed}/${validation.checkCount} 项检查通过，引用 ${evidence.references} 处源码。`);

// 2. 明暗 PNG：驱动无头 Chrome 点查看器的「导出 PNG」，再缩到 2x
const { findChrome } = await import(pathToFileURL(path.join(ARCHIFY_DIR, "bin/visual-check.mjs")).href);
const chrome = findChrome();
if (!chrome) fail("找不到 Chrome，无法导出 PNG（可设 ARCHIFY_CHROME 指定路径）。");
await exportPreviews(chrome);

// 3. 视口检查
let viewports;
if (skipVisual) {
  viewports = readJson(RECEIPT)?.viewports ?? [];
  console.log("跳过 visual-check，receipt 里的视口数据沿用上一份。");
} else {
  const visual = archify("visual-check", HTML);
  const sidecars = fs.readdirSync(DOCS).filter((name) => name.startsWith("architecture.visual-check."));
  for (const name of sidecars) fs.rmSync(path.join(DOCS, name), { force: true });
  viewports = visual.report.containment?.viewports ?? [];
  const summary = viewports.map((v) => `${v.width}×${v.height}${v.ok ? "" : ` 溢出 ${v.scrollWidth}×${v.scrollHeight}`}`).join("，");
  if (visual.report.status !== "pass") fail(`visual-check 未通过（${visual.report.status}）：${summary}`);
  console.log(`视口检查通过：${summary}。`);
}

// 4. receipt
const previous = readJson(RECEIPT) ?? {};
const previews = Object.fromEntries(
  THEMES.map((theme) => {
    const file = `architecture-${theme}.png`;
    const buffer = fs.readFileSync(path.join(DOCS, file));
    return [file, { kind: "svg-rasterization", sha256: sha256(buffer), bytes: buffer.length }];
  }),
);
fs.writeFileSync(
  RECEIPT,
  JSON.stringify(
    {
      type: "architecture",
      specification,
      artifact,
      validation,
      evidence,
      output: "architecture.html",
      visual_review: skipVisual ? (previous.visual_review ?? "pending") : "pending: 截图已重出，待人工过目",
      correction_rounds: previous.correction_rounds ?? 0,
      static_diagram_review: "pending: 打开 docs/architecture-light.png 确认后改成 passed",
      viewports,
      previews,
    },
    null,
    2,
  ) + "\n",
);
console.log(`receipt 已写入。看一眼 docs/architecture-light.png，没问题就把 receipt 里两处 pending 改成 passed。`);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function exportPreviews(chromePath) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "archify-profile-"));
  const downloads = fs.mkdtempSync(path.join(os.tmpdir(), "archify-downloads-"));
  const child = spawn(
    chromePath,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const cleanup = async () => {
    // Chrome 退出时还会往 profile 里写几笔，等它真正退出再删，否则 rm 会撞上 ENOTEMPTY
    child.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    fs.rmSync(downloads, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };

  try {
    const wsUrl = await new Promise((resolve, reject) => {
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
        const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) resolve(match[1]);
      });
      child.on("exit", (code) => reject(new Error(`Chrome 退出（${code}）\n${stderr}`)));
      setTimeout(() => reject(new Error(`等 Chrome DevTools 端口超时\n${stderr}`)), 15_000);
    });

    const cdp = await connectCdp(wsUrl);
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank", newWindow: true, width: 1920, height: 1080 });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads, eventsEnabled: true });

    const evaluate = async (expression) => {
      const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    };

    const loaded = cdp.waitFor((msg) => msg.method === "Page.loadEventFired" && msg.sessionId === sessionId);
    await cdp.send("Page.navigate", { url: pathToFileURL(HTML).href }, sessionId);
    await loaded;
    await evaluate("new Promise((r) => setTimeout(r, 800))");

    for (const theme of THEMES) {
      await evaluate(
        `document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)}); new Promise((r) => requestAnimationFrame(() => setTimeout(r, 300)))`,
      );
      const downloaded = cdp.waitFor((msg) => msg.method === "Browser.downloadProgress" && msg.params.state === "completed", 60_000);
      await evaluate(
        `(() => { const button = document.querySelector('#export-menu button[data-format="png"]'); if (!button) throw new Error("查看器里没有 PNG 导出按钮"); button.click(); return true; })()`,
      );
      await downloaded;
      const exportError = await evaluate('document.documentElement.getAttribute("data-last-export-error")');
      if (exportError) throw new Error(`查看器导出报错：${exportError}`);

      const [latest] = fs
        .readdirSync(downloads)
        .filter((name) => name.endsWith(".png"))
        .map((name) => path.join(downloads, name))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
      if (!latest) throw new Error("没等到下载完成的 PNG。");

      const target = path.join(DOCS, `architecture-${theme}.png`);
      const buffer = await sharp(latest).resize(previewSize[0], previewSize[1], { kernel: "lanczos3" }).png({ compressionLevel: 9 }).toBuffer();
      fs.writeFileSync(target, buffer);
      fs.rmSync(latest, { force: true });
      console.log(`PNG 已导出：${path.relative(ROOT, target)}（${previewSize.join("×")}，${(buffer.length / 1024).toFixed(0)} KB）`);
    }
    cdp.close();
  } finally {
    await cleanup();
  }
}

async function connectCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error(`连不上 ${wsUrl}`));
  });
  let seq = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
      return;
    }
    if (msg.method) for (const listener of listeners) listener(msg);
  };
  return {
    send: (method, params = {}, sessionId) =>
      new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      }),
    waitFor: (predicate, timeoutMs = 30_000) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          listeners.delete(listener);
          reject(new Error("等待 CDP 事件超时"));
        }, timeoutMs);
        const listener = (msg) => {
          if (!predicate(msg)) return;
          clearTimeout(timer);
          listeners.delete(listener);
          resolve(msg);
        };
        listeners.add(listener);
      }),
    close: () => ws.close(),
  };
}
