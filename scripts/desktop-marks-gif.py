#!/usr/bin/env python3
"""
生成根 README 里「页头的前台应用」那条品牌标识 GIF（docs/screenshots/desktop-marks-{light,dark}.gif）。

四段标识（Claude Code / Ghostty / Cursor / Antigravity）都从本地站点的页头真实截下来再拼成一条，
四段都会动、都逐帧截图：
  - Claude Code 是像素吉祥物的取物动画：装上 Playwright 的假时钟逐 25ms 推进，精灵 SVG 内容一变就
    截一帧，抓到完整一轮 33 个姿势；帧时长不用实测值，直接取 src/lib/mascot-fetch.json 里每一步的
    原始毫秒数。
  - Ghostty 是官网那只 ASCII 幽灵：同样在假时钟下按 SVG 的 data-frame 拨到第 0 帧起逐帧截满一轮，
    帧时长取 src/lib/ghostty-frames.json 的 frameMs。
  - Cursor 和 Antigravity 演示应用名下面那行窗口标题：各按 TITLE_SCRIPTS 的剧本让标题出现、变化、
    消失。这两段不用假时钟——标题的淡入淡出由 motion 交给 Web Animations API，那条时间线假时钟
    拨不动（钟拨快 5 秒，透明度动画就真的晚 5 秒才开始）。改成真实时间：注入新标题后借 SWR 的
    revalidateOnFocus 让页面回源一次（注入不发推送事件），数据一到就连续截图 0.7 秒，画面一变
    留一帧，帧时刻按真实经过的毫秒记；两次变化之间等多久都不进时间线。
GIF 一轮的长度等于 Ghostty 一轮（79 × 93ms ≈ 7.3 秒）：Claude Code 先跑完约 3.1 秒的取物，然后停在
首姿势等 Ghostty 转完（站点上每轮结束停 5 秒，这里停到轮尾约 4.3 秒）；标题剧本首尾都没有标题，
循环回到起点才接得上。四条时间线上任何一段换帧就出一张 GIF 帧，其余段保持上一帧。

前置：
  1. pnpm dev:worker 与 pnpm dev:local 已在跑（workers/api/.dev.vars 里 DEV_OVERRIDES=true）
  2. Python 3 + playwright + Pillow：pip install playwright pillow && playwright install chromium
     （装了 Google Chrome 的机器可设 PLAYWRIGHT_CHANNEL=chrome 免下载）
用法：
  python3 scripts/desktop-marks-gif.py            # 明暗各一张
  python3 scripts/desktop-marks-gif.py --theme dark
站点或 Worker 不在默认端口时用 SITE_URL / DEV_WORKER_URL 环境变量指过去（后者 dev:override 也认）。
脚本自己开总开关、注入 desktop 夹具，结束后清掉注入并把总开关恢复成原来的状态。
"""

from __future__ import annotations

import argparse
import bisect
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

try:
    from PIL import Image
    from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright
except ImportError as error:  # 给个能照着做的提示，别只抛 traceback
    sys.exit(f"缺少依赖 {error.name}：pip install playwright pillow && playwright install chromium")

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "docs/screenshots"
SITE_URL = os.environ.get("SITE_URL", "http://localhost:3211/")
WORKER_URL = os.environ.get("DEV_WORKER_URL", "http://localhost:8788").rstrip("/")
BROWSER_CHANNEL = os.environ.get("PLAYWRIGHT_CHANNEL") or None

# 四段标识：key、夹具文件、页头 aria-label 里的规范名（见 src/lib/desktop-app-overrides.tsx）
MARKS = [
    ("claude-code", "desktop-claude-code.json", "Claude Code"),
    ("ghostty", "desktop-ghostty.json", "Ghostty"),
    ("cursor", "desktop-cursor.json", "Cursor"),
    ("antigravity", "desktop-antigravity.json", "Google Antigravity"),
]
DESKTOP_PATH = "/api/status/desktop"
# 窗口标题剧本：(毫秒, 标题)，None 是没有标题。首尾都没有标题，循环才接得上；两段错开，不在同一刻动。
TITLE_SCRIPTS: dict[str, list[tuple[int, str | None]]] = {
    "cursor": [
        (1100, "telemetry.ts — lyjwpage"),
        (3600, "live-desk-card.tsx — lyjwpage"),
        (5900, None),
    ],
    "antigravity": [
        (2400, "pulse.ts — lyjwpage"),
        (4800, None),
    ],
}
PAD_X, PAD_Y = 24, 16  # 标识四周留白（CSS px），吉祥物取物时会探出左边界，左侧要够
GAP = 32  # 各段之间的间距（设备像素，2x）
STEP_MS = 25  # 吉祥物用的假时钟步长；源序列最短一步 50ms，25ms 不会漏帧
SETTLE_S = 0.7  # 每次换标题后连续截图这么久（真实秒）：标题的淡入淡出和图标缩放都是 280ms
FOCUS_THROTTLE_S = 5.1  # SWR 对 focus 触发的回源节流 5 秒（真实时间），两次触发之间至少等这么久

sequence = json.loads((ROOT / "src/lib/mascot-fetch.json").read_text())["sequence"]
# 第 1..33 步是取物过程；第 34 步和第 0 步都是姿势 0，合成轮尾的停顿
RUN_DURATIONS = [step["ms"] for step in sequence[1:-1]]

ghostty_frames = json.loads((ROOT / "src/lib/ghostty-frames.json").read_text())
GHOSTTY_FRAME_MS: int = ghostty_frames["frameMs"]
GHOSTTY_FRAME_COUNT: int = len(ghostty_frames["frames"])
CYCLE_MS = GHOSTTY_FRAME_MS * GHOSTTY_FRAME_COUNT


@dataclass
class Timeline:
    """一段动画在一轮 GIF 里的帧序列：starts[i] 是第 i 帧开始的毫秒，之后保持到下一帧。"""

    starts: list[int]
    paths: list[Path]

    def at(self, ms: int) -> Path:
        return self.paths[bisect.bisect_right(self.starts, ms) - 1]


def override(*args: str) -> str:
    result = subprocess.run(
        ["pnpm", "--silent", "dev:override", *args],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        env={**os.environ, "DEV_WORKER_URL": WORKER_URL},
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


def new_page(browser, theme: str, *, clock: bool):
    ctx = browser.new_context(
        viewport={"width": 1280, "height": 800},
        device_scale_factor=2,
        color_scheme=theme,
    )
    page = ctx.new_page()
    if clock:
        page.clock.install()
    page.goto(SITE_URL, wait_until="load", timeout=120_000)
    # 页面上总有轮询和长连接在跑，networkidle 等不到就算了；各段自己等标识出现、动画停稳
    try:
        page.wait_for_load_state("networkidle", timeout=10_000)
    except PlaywrightTimeoutError:
        pass
    if theme == "dark":
        page.wait_for_selector("html.dark")
    return page


def freeze_at_mark(page, sel: str, name: str):
    """假时钟不会自己走：边拨边等标识出现，等入场动画停稳后冻结时间，返回元素。"""
    for _ in range(400):
        if page.query_selector(sel):
            break
        page.clock.run_for(100)
        page.wait_for_timeout(20)
    else:
        raise SystemExit(f"假时钟下没等到 {name} 标识，检查夹具是否注入、总开关是否打开")
    element = page.query_selector(sel)
    page.clock.run_for(1500)
    # 冻结：之后时间只随 run_for 走，截图花的真实时间不会混进测得的时长。
    # Python 绑定把数字当秒处理，这里必须传 datetime。读 Date.now() 到真正暂停之间
    # 钟还在按真实时间走，pause_at 不能落在过去，往前多给 1 秒（入场动画早已停稳）。
    now_ms = page.evaluate("Date.now()")
    page.clock.pause_at(datetime.fromtimestamp((now_ms + 1000) / 1000, tz=timezone.utc))
    return element


def capture_mascot(page, sel: str, frames_dir: Path, theme: str) -> Timeline:
    """一轮取物的 34 帧：33 个过程姿势 + 末尾的姿势 0，姿势 0 一直停到 GIF 轮尾。"""
    element = freeze_at_mark(page, sel, "Claude Code")
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
    print(f"  {theme} Claude Code: {len(cycle)} 帧，实测一轮 {measured}ms（源数据 {sum(RUN_DURATIONS)}ms）", file=sys.stderr)
    starts = [0]
    for duration in RUN_DURATIONS:
        starts.append(starts[-1] + duration)
    return Timeline(starts, [item[1] for item in cycle])


def capture_ghostty(page, sel: str, frames_dir: Path, theme: str) -> Timeline:
    """从第 0 帧起逐帧截满一轮；帧号读 SVG 的 data-frame，不靠比对内容。"""
    element = freeze_at_mark(page, sel, "Ghostty")
    clip = clip_of(element)
    svg = page.locator(f"{sel} svg").first
    frame = lambda: int(svg.get_attribute("data-frame"))  # noqa: E731

    for _ in range(CYCLE_MS // 5 + 40):
        if frame() == 0:
            break
        page.clock.run_for(5)
    else:
        raise SystemExit("拨了一整轮也没等到 Ghostty 第 0 帧，假时钟下 rAF 是否在跑？")

    paths = []
    for index in range(GHOSTTY_FRAME_COUNT):
        if frame() != index:
            raise SystemExit(f"Ghostty 第 {index} 帧没对上，读到 {frame()}")
        path = frames_dir / f"ghostty-{theme}-{index:03d}.png"
        page.screenshot(path=str(path), clip=clip, scale="device")
        paths.append(path)
        for _ in range((GHOSTTY_FRAME_MS + 50) // 5):
            page.clock.run_for(5)
            if frame() != index:
                break
        else:
            raise SystemExit(f"Ghostty 停在第 {index} 帧不动了")
    print(f"  {theme} Ghostty: {len(paths)} 帧，每帧 {GHOSTTY_FRAME_MS}ms", file=sys.stderr)
    return Timeline([i * GHOSTTY_FRAME_MS for i in range(GHOSTTY_FRAME_COUNT)], paths)


def titled_fixture(base: str, title: str | None, path: Path) -> Path:
    """从 dev-fixtures 里的 desktop 夹具派生一份只改 windowTitle 的临时夹具（dev-override 认任意路径）。"""
    fixture = json.loads((ROOT / "workers/api/dev-fixtures" / base).read_text())
    fixture["data"]["desktop"]["windowTitle"] = title
    path.write_text(json.dumps(fixture, ensure_ascii=False))
    return path


def capture_titles(browser, key: str, fixture: str, name: str, frames_dir: Path, theme: str) -> Timeline:
    """按剧本让标题出现 / 变化 / 消失，每次变化后在真实时间里连续截图，画面一变就留一帧。"""
    sel = f'[aria-label="Using {name}"]'
    script = TITLE_SCRIPTS[key]
    variants = {
        title: titled_fixture(fixture, title, frames_dir / f"{key}-{index}.json")
        for index, title in enumerate(dict.fromkeys([None, *(title for _, title in script)]))
    }

    # 徽章在页头居中，带标题时两边一起变宽：先量出每种状态的框，取并集当这一段所有帧的裁剪框
    x0 = y0 = float("inf")
    x1 = y1 = float("-inf")
    for title, path in variants.items():
        override(DESKTOP_PATH, str(path))
        page = new_page(browser, theme, clock=False)
        element = page.wait_for_selector(sel, timeout=30_000)
        page.wait_for_timeout(1500)
        box = clip_of(element)
        x0, y0 = min(x0, box["x"]), min(y0, box["y"])
        x1, y1 = max(x1, box["x"] + box["width"]), max(y1, box["y"] + box["height"])
        page.context.close()
    clip = {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0}

    override(DESKTOP_PATH, str(variants[None]))
    page = new_page(browser, theme, clock=False)
    page.wait_for_selector(sel, timeout=30_000)
    page.wait_for_timeout(1500)  # 等应用切换的入场动画停稳
    shot = page.screenshot(clip=clip, scale="device")
    path = frames_dir / f"{key}-{theme}-000.png"
    path.write_bytes(shot)
    starts, paths = [0], [path]
    last_focus = float("-inf")
    for at_ms, title in script:
        if at_ms <= starts[-1]:
            raise SystemExit(f"{key} 剧本 {at_ms}ms 那步来得太早，上一步的过渡 {starts[-1]}ms 才收完")
        override(DESKTOP_PATH, str(variants[title]))
        # 注入不发推送事件，借 SWR 的 revalidateOnFocus 回源一次；它对 focus 节流 5 秒，不够就等够
        page.wait_for_timeout(max(0.0, FOCUS_THROTTLE_S - (time.perf_counter() - last_focus)) * 1000)
        page.evaluate("window.dispatchEvent(new Event('focus'))")
        last_focus = time.perf_counter()
        hover = f"{name} · {title}" if title else name  # 数据一到，容器的 title（hoverText）同步换掉
        for _ in range(150):
            if page.get_attribute(sel, "title") == hover:
                break
            page.wait_for_timeout(20)
        else:
            raise SystemExit(f"focus 后 3 秒页面还没拿到「{hover}」，检查夹具是否注入、总开关是否打开")
        arrived = time.perf_counter()
        while True:
            now = time.perf_counter()
            if now - arrived > SETTLE_S:
                break
            frame = page.screenshot(clip=clip, scale="device")
            if frame != shot:
                shot = frame
                path = frames_dir / f"{key}-{theme}-{len(paths):03d}.png"
                path.write_bytes(shot)
                paths.append(path)
                starts.append(at_ms + round((now - arrived) * 1000))
    if len(paths) < len(script) + 1:
        raise SystemExit(f"{key} 只截到 {len(paths)} 帧，标题变化没画出来")
    page.context.close()
    print(f"  {theme} {name}: {len(paths)} 帧，标题剧本 {len(script)} 步", file=sys.stderr)
    return Timeline(starts, paths)


def capture(theme: str, frames_dir: Path) -> dict[str, Timeline]:
    captured: dict[str, Timeline] = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(channel=BROWSER_CHANNEL)
        for key, fixture, name in MARKS:
            if key in TITLE_SCRIPTS:
                captured[key] = capture_titles(browser, key, fixture, name, frames_dir, theme)
                continue
            # 这两段只看标识本身：夹具里带的窗口标题去掉
            override(DESKTOP_PATH, str(titled_fixture(fixture, None, frames_dir / f"{key}-untitled.json")))
            page = new_page(browser, theme, clock=True)
            sel = f'[aria-label="Using {name}"]'
            if key == "claude-code":
                captured[key] = capture_mascot(page, sel, frames_dir, theme)
            else:
                captured[key] = capture_ghostty(page, sel, frames_dir, theme)
            page.context.close()
        browser.close()
    return captured


def compose(theme: str, captured: dict[str, Timeline]) -> Path:
    background = Image.open(captured["cursor"].paths[0]).convert("RGB").getpixel((0, 0))

    # 任一段换帧的时刻都出一张 GIF 帧，其余段保持上一帧。GIF 的延时以 10ms 计，浏览器又把
    # ≤10ms 当 100ms 播，所以相距不到 20ms 的换帧并成一张（画面取靠后那一刻的状态），
    # 帧时长按 10ms 网格累计取整，一轮总长不漂。
    events = sorted({0} | {ms for item in captured.values() for ms in item.starts if ms < CYCLE_MS})
    clusters: list[list[int]] = []
    for ms in events:
        if clusters and ms - clusters[-1][0] < 20:
            clusters[-1].append(ms)
        else:
            clusters.append([ms])
    grid = lambda ms: round(ms / 10) * 10  # noqa: E731
    frames = []
    durations = []
    for index, cluster in enumerate(clusters):
        ms = cluster[-1]
        parts = [Image.open(captured[key].at(ms)).convert("RGB") for key, _, _ in MARKS]
        height = parts[0].height
        assert all(part.height == height for part in parts)
        width = sum(part.width for part in parts) + GAP * (len(parts) - 1)
        strip = Image.new("RGB", (width, height), background)
        x = 0
        for part in parts:
            strip.paste(part, (x, 0))
            x += part.width + GAP
        frames.append(strip)
        next_ms = clusters[index + 1][0] if index + 1 < len(clusters) else CYCLE_MS
        durations.append(grid(next_ms) - grid(cluster[0]))
    assert min(durations) >= 20, durations

    # 全帧共用一个调色板，没在动的那几段才不会在帧间抖色
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
        duration=durations,
        loop=0,
        optimize=True,
        disposal=1,
    )
    print(f"  {out.relative_to(ROOT)}：{frames[0].width}×{frames[0].height}，{len(frames)} 帧，"
          f"一轮 {sum(durations)}ms，{out.stat().st_size} 字节", file=sys.stderr)
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
        override(DESKTOP_PATH, "--clear")
        if not was_enabled:
            override("--off")


if __name__ == "__main__":
    main()
