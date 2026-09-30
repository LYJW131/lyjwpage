#!/usr/bin/env node
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
const LOCK = readJson(path.join(ROOT, "scripts/archify.lock.json"));
const TOOLCHAIN = path.join(ROOT, ".archify", "toolchain", LOCK.commit);
const ARCHIFY_DIR = path.resolve(process.env.ARCHIFY_DIR ?? path.join(TOOLCHAIN, "archify"));
const ARCHIFY = path.join(ARCHIFY_DIR, "bin/archify.mjs");
const PREVIEW_SCALE = 2;
const PREVIEW_PNG = { palette: true, quality: 90, colours: 256, dither: 0, effort: 10, compressionLevel: 9 };
const THEMES = ["light", "dark"];

const args = new Set(process.argv.slice(2));
const validateOnly = args.has("--validate");
const skipVisual = args.has("--skip-visual");

if (args.has("--setup")) {
  if (process.env.ARCHIFY_DIR) fail("--setup 不修改 ARCHIFY_DIR；取消该变量以安装仓库隔离工具链。");
  if (!fs.existsSync(TOOLCHAIN)) {
    fs.mkdirSync(path.dirname(TOOLCHAIN), { recursive: true });
    const staging = fs.mkdtempSync(path.join(path.dirname(TOOLCHAIN), "install-"));
    try {
      git(["clone", "--no-checkout", "--filter=blob:none", LOCK.repository, staging]);
      git(["-C", staging, "checkout", "--detach", LOCK.commit]);
      fs.renameSync(staging, TOOLCHAIN);
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }
}
if (!fs.existsSync(ARCHIFY)) fail(`找不到 archify：${ARCHIFY}\n先运行 pnpm docs:architecture -- --setup，或设置 ARCHIFY_DIR。`);
const version = readJson(path.join(ARCHIFY_DIR, "package.json"))?.version;
if (version !== LOCK.version) fail(`Archify 版本不匹配：要求 ${LOCK.version}，实际 ${version ?? "unknown"}。`);
if (!process.env.ARCHIFY_DIR) {
  if (git(["-C", TOOLCHAIN, "rev-parse", "HEAD"]).trim() !== LOCK.commit
      || git(["-C", TOOLCHAIN, "status", "--porcelain", "--untracked-files=all"]).trim()) {
    fail("隔离 Archify 工具链与锁定提交不符，或存在本地修改。");
  }
}
if (args.has("--setup")) {
  console.log(`Archify ${version} 已就绪：${ARCHIFY_DIR}`);
  process.exit(0);
}

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) fail(`git ${args[0]} 失败：${result.stderr}`);
  return result.stdout;
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

const specArgs = ["architecture", SPEC, "--quality", "showcase", "--repo-root", ROOT];
if (validateOnly) {
  const { report, status } = archify("validate", ...specArgs);
  if (status !== 0 || !report.ok) {
    printDiagnostics(report);
    fail("校验未通过。");
  }
  console.log(`校验通过：${report.checks.length} 项检查全部 ok。`);
  process.exit(0);
}

const evidenceRoot = path.join(ROOT, ".archify", "evidence");
fs.mkdirSync(evidenceRoot, { recursive: true });
const evidenceDirectory = fs.mkdtempSync(path.join(evidenceRoot, "architecture-"));
const finalized = archify("finalize", ...specArgs.slice(0, 2), HTML, ...specArgs.slice(2), "--out-dir", evidenceDirectory);
if (finalized.status !== 0 || !finalized.report.ok) {
  printDiagnostics(finalized.report);
  fail(`finalize 未通过，证据保留在 ${evidenceDirectory}。`);
}
const full = readJson(finalized.report.evidence.receipt);
const delivered = full.stages.deliver.receipt;
const browser = full.stages["browser-check"].receipt;
const { specification, artifact, validation, evidence } = delivered;
console.log(`finalize 已通过：${validation.checksPassed}/${validation.checkCount} 项检查，浏览器证据 ${browser.status}。`);

const { findChrome } = await import(pathToFileURL(path.join(ARCHIFY_DIR, "bin/visual-check.mjs")).href);
const chrome = findChrome();
if (!chrome) fail("找不到 Chrome，无法导出 PNG（可设 ARCHIFY_CHROME 指定路径）。");
const previewSizes = await exportPreviews(chrome, evidenceDirectory);

let capture = null;
if (!skipVisual) {
  const visual = archify("visual-check", HTML, "--require-provenance", "--out-dir", evidenceDirectory);
  if (visual.status !== 0 || visual.report.status !== "pass") {
    printDiagnostics(visual.report);
    fail(`visual-check 未通过，证据保留在 ${evidenceDirectory}。`);
  }
  capture = visual.report;
}
if (sha256(fs.readFileSync(SPEC)) !== specification.sha256 || sha256(fs.readFileSync(HTML)) !== artifact.sha256) {
  fail("生成期间规格或 HTML 被修改；当前预览与回执不可交付，请完整重跑。");
}
const previews = Object.fromEntries(THEMES.map((theme) => {
  const file = `architecture-${theme}.png`;
  const buffer = fs.readFileSync(path.join(DOCS, file));
  return [file, { kind: "viewer-png-export", theme, encoding: { format: "png", ...PREVIEW_PNG }, ...previewSizes[theme], artifactSha256: artifact.sha256, sha256: sha256(buffer), bytes: buffer.length }];
}));
fs.writeFileSync(RECEIPT, JSON.stringify({
  type: "architecture",
  generator: { ...LOCK, source: process.env.ARCHIFY_DIR ? "ARCHIFY_DIR (version verified)" : "isolated pinned checkout" },
  specification,
  artifact,
  validation,
  evidence,
  output: "architecture.html",
  gates: finalized.report.gates,
  browser_evidence: browser.status === "pass" ? "passed" : browser.status,
  browser_check: browser,
  update: finalized.report.update,
  visualReviewRecommendation: finalized.report.visualReviewRecommendation,
  visual_review: "pending: inspect current HTML and both exported PNGs",
  correction_rounds: 0,
  static_diagram_review: "pending: inspect both current exported PNGs",
  capture: capture ? { status: capture.status, artifact: capture.artifact, evidenceDirectory: path.relative(ROOT, evidenceDirectory) } : { status: "not-requested" },
  viewports: browser.containment.viewports,
  previews,
}, null, 2) + "\n");
console.log(`receipt 已写入；人工检查当前 HTML 和明暗 PNG 后记录实际审阅结果。证据：${evidenceDirectory}`);

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

async function exportPreviews(chromePath, evidenceDirectory) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "archify-profile-"));
  const downloads = fs.mkdtempSync(path.join(os.tmpdir(), "archify-downloads-"));
  const child = spawn(
    chromePath,
    [
      "--headless=new",
      ...((process.getuid?.() === 0 || process.env.ARCHIFY_CHROME_NO_SANDBOX === "1") ? ["--no-sandbox"] : []),
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
      const timer = setTimeout(() => reject(new Error(`等 Chrome DevTools 端口超时\n${stderr}`)), 15_000);
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
        const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Chrome 退出（${code}）\n${stderr}`));
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
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
    await evaluate("document.fonts.ready");
    const previewWidth = await evaluate(`(() => {
      const box = document.querySelector('.diagram-container svg')?.viewBox.baseVal;
      if (!box || box.width <= 0 || box.height <= 0) throw new Error("查看器 SVG 缺少有效 viewBox");
      return Math.round(box.width * ${PREVIEW_SCALE});
    })()`);

    const previewSizes = {};
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

      const originalPath = path.join(evidenceDirectory, `architecture-${theme}.viewer-original.png`);
      fs.copyFileSync(latest, originalPath, fs.constants.COPYFILE_EXCL);
      const originalBuffer = fs.readFileSync(originalPath);
      const originalInfo = await sharp(originalBuffer).metadata();
      const target = path.join(DOCS, `architecture-${theme}.png`);
      // Viewer PNGs include a title and frame outside the SVG; fixed-height resizing crops them.
      const { data: buffer, info } = await sharp(latest).resize({ width: previewWidth, kernel: "lanczos3" }).png(PREVIEW_PNG).toBuffer({ resolveWithObject: true });
      previewSizes[theme] = {
        width: info.width,
        height: info.height,
        original: {
          path: path.relative(ROOT, originalPath),
          sha256: sha256(originalBuffer),
          bytes: originalBuffer.length,
          width: originalInfo.width,
          height: originalInfo.height,
        },
      };
      fs.writeFileSync(target, buffer);
      fs.rmSync(latest, { force: true });
      console.log(`PNG 已导出：${path.relative(ROOT, target)}（${info.width}×${info.height}，${(buffer.length / 1024).toFixed(0)} KB）`);
    }
    cdp.close();
    return previewSizes;
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
