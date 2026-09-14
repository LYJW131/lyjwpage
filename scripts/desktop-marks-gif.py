#!/usr/bin/env python3
"""
生成根 README 里「页头的前台应用」那条品牌字标 GIF（docs/screenshots/desktop-marks-{light,dark}.gif）。

三段字标（Claude Code / Cursor / Antigravity）都从本地站点的页头真实截下来再拼成一条，
Claude Code 那段是像素吉祥物的取物动画：装上 Playwright 的假时钟逐 25ms 推进，精灵
SVG 内容一变就截一帧，抓到完整一轮 33 个姿势；帧时长不用实测值，直接取
src/lib/mascot-fetch.json 里每一步的原始毫秒数。站点上每轮结束停 5 秒，GIF 里不停，
首姿势只保留源数据自带的两步（767 + 258 ms），整轮 4.1 秒连续循环。

前置：
  1. pnpm dev:worker 与 pnpm dev:local 已在跑（workers/api/.dev.vars 里 DEV_OVERRIDES=true）
  2. Python 3 + playwright + Pillow：pip install playwright pillow && playwright install chromium
用法：
  python3 scripts/desktop-marks-gif.py            # 明暗各一张
  python3 scripts/desktop-marks-gif.py --theme dark
脚本自己开总开关、注入 desktop 夹具，结束后清掉注入并把总开关恢复成原来的状态。
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

try:
    from PIL import Image
    from playwright.sync_api import sync_playwright
except ImportError as error:  # 给个能照着做的提示，别只抛 traceback
    sys.exit(f"缺少依赖 {error.name}：pip install playwright pillow && playwright install chromium")

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "docs/screenshots"
SITE_URL = "http://localhost:3211/"
WORKER_URL = "http://localhost:8788"

# 三段字标：夹具文件、页头 aria-label 里的规范名（见 src/lib/desktop-app-overrides.tsx）
MARKS = [
    ("claude-code", "desktop-claude-code.json", "Claude Code"),
    ("cursor", "desktop-cursor.json", "Cursor"),
    ("antigravity", "desktop-antigravity.json", "Google Antigravity"),
]
PAD_X, PAD_Y = 24, 16  # 字标四周留白（CSS px），吉祥物取物时会探出左边界，左侧要够
GAP = 32  # 三段之间的间距（设备像素，2x）
STEP_MS = 25  # 假时钟步长；源序列最短一步 50ms，25ms 不会漏帧

sequence = json.loads((ROOT / "src/lib/mascot-fetch.json").read_text())["sequence"]
# 第 1..33 步是取物过程；第 34 步和第 0 步都是姿势 0，和站点的停顿一起合成末帧
RUN_DURATIONS = [step["ms"] for step in sequence[1:-1]]
IDLE_MS = sequence[-1]["ms"] + sequence[0]["ms"]


def override(*args: str) -> str:
    result = subprocess.run(
        ["pnpm", "--silent", "dev:override", *args],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout


def override_enabled() -> bool:
    with urllib.request.urlopen(f"{WORKER_URL}/api/dev/overrides", timeout=10) as response:
        return bool(json.load(response).get("enabled"))


def clip_of(element) -> dict[str, float]:
    box = element.bounding_box()
    return {
        "x": box["x"] - PAD_X,
        "y": box["y"] - PAD_Y,
        "width": box["width"] + 2 * PAD_X,
        "height": box["height"] + 2 * PAD_Y,
    }


def capture_static(page, sel: str, path: Path) -> None:
    element = page.wait_for_selector(sel, timeout=30_000)
    page.wait_for_timeout(1500)  # 等应用切换的入场动画停稳
    page.screenshot(path=str(path), clip=clip_of(element), scale="device")


def capture_mascot(page, sel: str, frames_dir: Path, theme: str) -> list[Path]:
    """返回一轮取物的 34 帧：33 个过程姿势 + 末尾的姿势 0。"""
    # 假时钟不会自己走，等字标出现的同时得手动拨
    for _ in range(400):
        if page.query_selector(sel):
            break
        page.clock.run_for(100)
        page.wait_for_timeout(20)
    else:
        raise SystemExit("假时钟下没等到 Claude Code 字标，检查夹具是否注入、总开关是否打开")
    element = page.query_selector(sel)
    page.clock.run_for(1500)
    # 冻结：之后时间只随 run_for 走，截图花的真实时间不会混进测得的时长。
    # Python 绑定把数字当秒处理，这里必须传 datetime。
    now_ms = page.evaluate("Date.now()")
    page.clock.pause_at(datetime.fromtimestamp(now_ms / 1000, tz=timezone.utc))
    clip = clip_of(element)

    svg = page.locator(f'{sel} svg[shape-rendering="crispEdges"]').first
    read = lambda: svg.evaluate("n => n.innerHTML")  # noqa: E731

    # 到达时动画可能正在中途，先录 ~16 秒的姿势变化，再按「停得最久的那一帧是姿势 0」切出一轮
    timeline: list[list] = []  # [content, path, duration_ms]
    current = read()
    path = frames_dir / f"claude-{theme}-000.png"
    page.screenshot(path=str(path), clip=clip, scale="device")
    timeline.append([current, path, 0])
    for _ in range(16_000 // STEP_MS):
        page.clock.run_for(STEP_MS)
        timeline[-1][2] += STEP_MS
        content = read()
        if content != current:
            current = content
            path = frames_dir / f"claude-{theme}-{len(timeline):03d}.png"
            page.screenshot(path=str(path), clip=clip, scale="device")
            timeline.append([content, path, 0])

    idles = [i for i, item in enumerate(timeline) if item[2] >= 1200]
    if len(idles) < 2:
        raise SystemExit("16 秒内没录到完整一轮取物动画")
    cycle = timeline[idles[0] + 1 : idles[1] + 1]
    if len(cycle) != len(RUN_DURATIONS) + 1:
        raise SystemExit(f"录到 {len(cycle)} 帧，与 mascot-fetch.json 的 {len(RUN_DURATIONS) + 1} 帧不符")
    measured = sum(item[2] for item in cycle[:-1])
    print(f"  {theme}: {len(cycle)} 帧，实测一轮 {measured}ms（源数据 {sum(RUN_DURATIONS)}ms）", file=sys.stderr)
    return [item[1] for item in cycle]


def capture(theme: str, frames_dir: Path) -> dict[str, list[Path] | Path]:
    captured: dict[str, list[Path] | Path] = {}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for key, fixture, name in MARKS:
            override("/api/status/desktop", fixture)
            ctx = browser.new_context(
                viewport={"width": 1280, "height": 800},
                device_scale_factor=2,
                color_scheme=theme,
            )
            page = ctx.new_page()
            animated = key == "claude-code"
            if animated:
                page.clock.install()
            page.goto(SITE_URL, wait_until="networkidle")
            if theme == "dark":
                page.wait_for_selector("html.dark")
            sel = f'[aria-label="正在使用：{name}"]'
            if animated:
                captured[key] = capture_mascot(page, sel, frames_dir, theme)
            else:
                path = frames_dir / f"{key}-{theme}.png"
                capture_static(page, sel, path)
                captured[key] = path
            ctx.close()
        browser.close()
    return captured


def compose(theme: str, captured: dict[str, list[Path] | Path]) -> Path:
    cursor = Image.open(captured["cursor"]).convert("RGB")
    antigravity = Image.open(captured["antigravity"]).convert("RGB")
    background = cursor.getpixel((0, 0))

    frames = []
    for path in captured["claude-code"]:
        mark = Image.open(path).convert("RGB")
        assert mark.height == cursor.height == antigravity.height
        width = mark.width + cursor.width + antigravity.width + 2 * GAP
        strip = Image.new("RGB", (width, mark.height), background)
        x = 0
        for part in (mark, cursor, antigravity):
            strip.paste(part, (x, 0))
            x += part.width + GAP
        frames.append(strip)

    # 全帧共用一个调色板，静止的 Cursor / Antigravity 才不会在帧间抖色
    sheet = Image.new("RGB", (frames[0].width, frames[0].height * len(frames)))
    for i, frame in enumerate(frames):
        sheet.paste(frame, (0, i * frame.height))
    palette = sheet.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    quantized = [frame.quantize(palette=palette, dither=Image.Dither.NONE) for frame in frames]

    out = OUT_DIR / f"desktop-marks-{theme}.gif"
    quantized[0].save(
        out,
        save_all=True,
        append_images=quantized[1:],
        duration=RUN_DURATIONS + [IDLE_MS],
        loop=0,
        optimize=True,
        disposal=1,
    )
    print(f"  {out.relative_to(ROOT)}：{frames[0].width}×{frames[0].height}，{len(frames)} 帧，"
          f"一轮 {sum(RUN_DURATIONS) + IDLE_MS}ms，{out.stat().st_size} 字节", file=sys.stderr)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--theme", choices=["light", "dark"], action="append", help="默认明暗都生成")
    args = parser.parse_args()
    themes = args.theme or ["light", "dark"]

    try:
        was_enabled = override_enabled()
    except OSError as error:
        sys.exit(f"连不上本地 Worker {WORKER_URL}：{error}。先起 pnpm dev:worker 与 pnpm dev:local")
    override("--on")
    try:
        with tempfile.TemporaryDirectory(prefix="desktop-marks-") as tmp:
            frames_dir = Path(tmp)
            for theme in themes:
                print(f"截取 {theme}…", file=sys.stderr)
                compose(theme, capture(theme, frames_dir))
    finally:
        override("/api/status/desktop", "--clear")
        if not was_enabled:
            override("--off")


if __name__ == "__main__":
    main()
