#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { cmdCards, cmdDoctor, cmdShot } from "./site-verify/cards.ts";
import { DEFAULT_URL, errorText, ExitError, fail, parseArgs, print, ROOT, WORKER_URL, type Flags } from "./site-verify/cli.ts";
import { cmdReload } from "./site-verify/reload.ts";
import { cmdSkew } from "./site-verify/skew.ts";

export { HIDE_DEV_UI, launchBrowser, resolvePlaywright } from "./site-verify/browser.ts";
export { loadFeatureMap, requiredCardIds, type FeatureMap } from "./site-verify/cards.ts";
export { parseArgs, parseWidths } from "./site-verify/cli.ts";
export { classifyRequest, consoleClean, consoleProblems, isEnvNoise, navOrigin, newSink, updateOrigin, type Sink } from "./site-verify/console-sink.ts";
export { findJumps, textJumps } from "./site-verify/reload.ts";
export { documentCommit, skewVerdict, staleAssetHtml } from "./site-verify/skew.ts";

const DEV_OVERRIDE = path.join(ROOT, "scripts", "dev-override.ts");

const HELP = `site-verify — 站点验证共用脚本（lyjwpage-verify）

用法：node scripts/site-verify.ts <子命令> [选项]   输出一律 JSON，--compact 单行。

子命令：
  doctor    检查环境：站点可访问、playwright 可加载、Chrome 能起、本地 Worker 夹具开关
  cards     按 .claude/skills/lyjwpage-verify/feature-map.json 逐张卡片检查存在与可见
  shot      按宽度截图（整页或单卡 clip），同时收集控制台 error / warn / pageerror
  reload    热缓存刷新，查首次绘制后的跳动（字体换装、时间跳、卡片晚到）
  skew      旧页面撞上新部署：用旧 HTML 打开当前站点，查它引用的资源取不取得到、页面有没有样式与水合
  override  夹具注入，转发给 scripts/dev-override.ts（成套注入用 pnpm dev:scene）；--dry-run 只打印命令不执行

公共选项：
  --url <url>         被测站点（默认 http://localhost:3211，或 DEV_SITE_PORT 环境变量）
  --compact           JSON 输出压成单行
  --chrome <path>     Chrome 可执行文件（也可设 SITE_VERIFY_CHROME）

doctor:
  例子  node scripts/site-verify.ts doctor --url http://localhost:3291

cards:
  --card <id[,id]>    只查指定卡片
  --width <px>        视口宽（默认 1280）  --height <px> 视口高（默认 900）
  --theme dark|light  色彩方案（默认 light）
  --settle <ms>       加载后等待毫秒（默认 4000；页面常开 WebSocket，没有 networkidle）
  例子  node scripts/site-verify.ts cards --url http://localhost:3291 --card pulse,vibe-coding

shot:
  --widths <w,w>      宽度列表（默认 1280,375；高度按常用机型取，可用 --height 覆盖）
  --card <id>         只截功能地图里这张卡（元素 clip）
  --viewport          只截视口（默认截整页 fullPage）
  --theme dark|light|both（默认 light）  --dpr <n> 像素密度（默认 1）
  --out <目录>        截图输出目录（必填）  --settle <ms>（默认 4000）
  --ssr               禁用 JavaScript，看 SSR HTML 长什么样
  截图藏起开发环境的调试按钮坞与 Vite 报错浮层（报错照样进控制台记录）；多张卡的数据要对得上时先 pnpm dev:scene
  例子  node scripts/site-verify.ts shot --url http://localhost:3291 --widths 1280,375 --out /tmp/shots

reload（热缓存刷新：先加载一次暖缓存，再刷新，查首次绘制之后又变过的文字、画面和字体）：
  --engine chromium|webkit  浏览器（默认 chromium；webkit 要装 Playwright 的 WebKit，只查文字与字体，不录屏）
  --width <px> --height <px>  视口（默认 375x1600：手机宽，高到首页顶部有大图时也录得到下面的卡片）   --theme dark|light（默认 dark）
  --skew <分钟>       浏览器时钟比服务端快几分钟，模拟首屏 HTML 是缓存的旧版（默认 2；0 关掉）
  --latency <ms>      走网络的请求加多少往返延迟，仅 chromium（默认 100；命中缓存的不受影响，每次重新验证的资源会晚到）
  --watch <ms>        刷新后录多久（默认 5000）    --grace <ms> 首次绘制后多久内的变化算流式补齐（默认 100）
  --out <目录>        帧与结果输出目录（必填）
  判据：textJumps 是首次绘制后只变过一两次的文字（时间从快照跳到此刻、水合才补上的内容）；
  frameJumps 是录屏里只变过一两次的画面区域（字体换装、卡片晚到、布局挪动），帧存在 --out；
  fontsAfterPaint 是首帧时还没加载完的字体；liveText / liveRegions 是反复变化的地方（歌词、进度、视频），只列出不判失败。
  例子  node scripts/site-verify.ts reload --url http://localhost:3211 --out /tmp/reload

skew（模拟 Safari 恢复后台标签时按缓存取回的旧 HTML）：
  --old-html <文件>   用这份旧首页 HTML（合并前 curl -s https://lyjw.me/ > 文件 存下）。判据：它引用的 /assets/ 全取得到
                      （R2 存档兜住）、只加载 1 次、有样式、已水合
  不带 --old-html     把当前首页的 JS / CSS 指纹全改成不存在的，判据：自动刷新恰好 1 次后有样式、已水合
  --engine chromium|webkit（默认 chromium）  --width <px> --height <px>（默认 375x812）
  --watch <ms>        打开后等多久再判（默认 8000）   --out <目录>  存一张最后停下的截图（可选）
  例子  node scripts/site-verify.ts skew --url https://lyjw.me --old-html /tmp/old-home.html

override（会改本地 Worker 状态；先 pnpm dev:worker + pnpm dev:local，workers/core/.dev.vars 需 DEV_OVERRIDES=true）：
  --endpoint <路径> --fixture <夹具.json>   注入（夹具名见功能地图 endpoints）
  --endpoint <路径> --clear                 清掉一条注入
  --on | --off                              总开关        --list  列出当前注入（只读）
  --dry-run                                 只打印将执行的 pnpm dev:override 命令
  例子  node scripts/site-verify.ts override --endpoint /api/status/pulse --fixture pulse-busy-day.json --dry-run
`;

function cmdOverride(flags: Flags) {
  const argv: string[] = [];
  if (flags.list) argv.push("--list");
  else if (flags.on || flags.off) argv.push(flags.on ? "--on" : "--off");
  else if (flags.endpoint && flags.clear) argv.push(String(flags.endpoint), "--clear");
  else if (flags.endpoint && flags.fixture) argv.push(String(flags.endpoint), String(flags.fixture));
  else {
    fail(
      "override 参数不全",
      "要 --endpoint <路径> --fixture <夹具.json>，或 --endpoint <路径> --clear，或 --on/--off/--list。夹具名见功能地图 endpoints。",
      2,
    );
  }
  const command = `pnpm dev:override ${argv.join(" ")}`;
  if (flags["dry-run"]) {
    print({ ok: true, dryRun: true, command, workerUrl: WORKER_URL, next: "去掉 --dry-run 执行；前提是本地 Worker 在跑且 DEV_OVERRIDES=true" }, flags);
    return;
  }
  const result = spawnSync("node", [DEV_OVERRIDE, ...argv], {
    cwd: ROOT,
    env: { ...process.env, DEV_WORKER_URL: WORKER_URL },
    encoding: "utf8",
  });
  const ok = result.status === 0;
  print(
    {
      ok,
      command,
      workerUrl: WORKER_URL,
      exitCode: result.status,
      stdout: result.stdout?.trim() ?? "",
      ...(result.stderr?.trim() ? { stderr: result.stderr.trim() } : {}),
      ...(ok ? {} : { next: "本地 Worker 要在跑（pnpm dev:worker + pnpm dev:local），且 workers/core/.dev.vars 里 DEV_OVERRIDES=true" }),
    },
    flags,
  );
  if (!ok) process.exitCode = result.status || 1;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const command = parsed.positional[0] ?? (parsed.flags.help ? "help" : null);
  const flags: Flags = { ...parsed.flags, url: String(parsed.flags.url || DEFAULT_URL).replace(/\/+$/, "") };
  if (!command || command === "help" || flags.help === true) {
    process.stdout.write(HELP);
    if (!command && !flags.help) process.exitCode = 2;
    return;
  }
  if (command === "doctor") return cmdDoctor(flags);
  if (command === "cards") return cmdCards(flags);
  if (command === "shot") return cmdShot(flags);
  if (command === "override") return cmdOverride(flags);
  if (command === "reload") return cmdReload(flags);
  if (command === "skew") return cmdSkew(flags);
  fail(`未知子命令：${command}`, "可用：doctor / cards / shot / reload / skew / override；--help 看全部选项", 2);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((caught: unknown) => {
    let error = caught;
    if (!(error instanceof ExitError)) {
      print({ ok: false, error: errorText(error), next: "带 --help 看用法；疑似 bug 时把这条错误贴回主线程" });
      error = new ExitError(1);
    }
    process.exitCode = (error as ExitError).code;
  });
}
