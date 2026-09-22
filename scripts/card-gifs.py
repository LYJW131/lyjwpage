#!/usr/bin/env python3
"""
生成根 README 里几张会动的卡片效果图（docs/screenshots/<场景>-{light,dark}.gif）。

每个场景都从本地站点真实录下来：把卡片滚到视口、藏起邻居，然后在真实时间里连续截图，
画面一变留一帧，帧时长按真实经过的毫秒记。不用 Playwright 的假时钟——motion 把不少动画交给
Web Animations API，假时钟拨不动它（见 desktop-marks-gif.py）。

场景（SCENES）：
  - now-listening  逐字歌词：从上一句收尾录到「二人だけの空が広がる夜に」整句扫完
  - activity       活动数据从上午换到下午：三环转到新读数、数字滚动
  - charger        充电头换一档功率：端口读数滚动、曲线末尾接上新点
  - server         落地节点换一档读数：速率、CPU、内存滚动
  - vibecoding     AI Coding 涨一档用量：Token、成本、限额百分比滚动
后四个靠换夹具驱动：注入不发推送事件，借 SWR 的 revalidateOnFocus 让卡片回源一次（对 focus 节流
5 秒，真实时间）。换夹具的等待不进时间线，GIF 里只有变化前后各留一小段。充电头的历史点在派生
变体时冻成绝对时间：`$now-…` 令牌每次注入都按新的当下重算，曲线会整条平移、和已有点对不上。
AI Coding 没有夹具，基线直接取本地 Worker 此刻的响应（生产数据经上游补缺）。

前置：本地 Worker 与 pnpm dev:local 在跑、总开关已开，并且这些夹具已注入（脚本不替你注入基线）：
  listening/now  listening-now-yoasobi.json     /api/lyrics       生产站响应包一层 ok（见 docs/README.md）
  charger        charger-macbook-iphone.json    powerbank         powerbank-charging.json
  activity       activity-afternoon.json        workouts          workouts.json
  server         server-traffic.json
Python 3 + playwright + Pillow：pip install playwright pillow（装了 Google Chrome 可设
PLAYWRIGHT_CHANNEL=chrome 免下载）。站点或 Worker 不在默认端口时用 SITE_URL / DEV_WORKER_URL。
用法：
  python3 scripts/card-gifs.py                      # 全部场景，明暗各一张
  python3 scripts/card-gifs.py --scene charger --theme dark
"""

from __future__ import annotations

import argparse
import io
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

try:
    from PIL import Image
    from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright
except ImportError as error:
    sys.exit(f"缺少依赖 {error.name}：pip install playwright pillow")

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "docs/screenshots"
FIXTURES = ROOT / "workers/api/dev-fixtures"
SITE_URL = os.environ.get("SITE_URL", "http://localhost:3211/")
WORKER_URL = os.environ.get("DEV_WORKER_URL", "http://localhost:8788").rstrip("/")
BROWSER_CHANNEL = os.environ.get("PLAYWRIGHT_CHANNEL") or None

SCALE = 2  # 设备像素比；和静态效果图一致
PAD = 12  # 卡片四周留白（CSS px），够露出 3px 硬阴影
VIEWPORT_H = 2200
FOCUS_THROTTLE_S = 5.1  # SWR 对 focus 触发的回源节流 5 秒


def override(*args: str) -> None:
    subprocess.run(
        ["pnpm", "--silent", "dev:override", *args],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        env={**os.environ, "DEV_WORKER_URL": WORKER_URL},
    )


def card(label: str) -> str:
    """按卡片标题栏那个等宽小标签定位整张卡"""
    return f'.paper-card:has(span.label-mono:text-is("{label}"))'


class Recorder:
    """在真实时间里连续截图；画面一变留一帧，帧时刻是 GIF 时间线上的毫秒。

    时间线只在 record / hold 里前进：换夹具、等节流这些真实等待不算。"""

    def __init__(self, page, clip: dict[str, float]):
        self.page = page
        self.clip = clip
        self.t = 0
        self.frames: list[tuple[int, bytes]] = []
        self.last: bytes | None = None

    def shot(self) -> bytes:
        return self.page.screenshot(clip=self.clip, scale="device")

    def _keep(self, at: int, frame: bytes) -> None:
        if frame != self.last:
            self.frames.append((at, frame))
            self.last = frame

    def start(self) -> None:
        self._keep(0, self.shot())

    def record(self, seconds: float) -> None:
        began = time.perf_counter()
        while True:
            now = time.perf_counter() - began
            if now > seconds:
                break
            self._keep(self.t + round(now * 1000), self.shot())
        self.t += round(seconds * 1000)

    def wait_change(self, timeout: float = 4.0) -> None:
        """等画面开始变（数据到了、过渡起步），第一张不同的帧落在当前时刻；等待本身不进时间线"""
        began = time.perf_counter()
        while time.perf_counter() - began < timeout:
            frame = self.shot()
            if frame != self.last:
                self._keep(self.t, frame)
                return
        raise SystemExit("等了几秒画面没变：夹具是否注入、总开关是否打开、focus 回源是否生效")

    def hold(self, ms: int) -> None:
        self.t += ms


def write_gif(rec: Recorder, out: Path) -> None:
    """全帧共用一个调色板；调色板从缩小 4 倍的拼图上算，整幅拼图太大。"""
    kept: list[tuple[int, Image.Image]] = []
    for at, frame in rec.frames:
        # GIF 延时以 10ms 计、浏览器把 ≤10ms 当 100ms 播，相距不到 20ms 的帧只留后一张
        if kept and at - kept[-1][0] < 20:
            kept[-1] = (kept[-1][0], Image.open(io.BytesIO(frame)).convert("RGB"))
            continue
        kept.append((at, Image.open(io.BytesIO(frame)).convert("RGB")))
    small = [im.reduce(4) for _, im in kept]
    sheet = Image.new("RGB", (small[0].width, sum(im.height for im in small)))
    y = 0
    for im in small:
        sheet.paste(im, (0, y))
        y += im.height
    palette = sheet.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    quantized = [im.quantize(palette=palette, dither=Image.Dither.NONE) for _, im in kept]
    grid = lambda ms: round(ms / 10) * 10  # noqa: E731
    durations = []
    for index, (at, _) in enumerate(kept):
        next_at = kept[index + 1][0] if index + 1 < len(kept) else rec.t
        durations.append(max(20, grid(next_at) - grid(at)))
    quantized[0].save(
        out,
        save_all=True,
        append_images=quantized[1:],
        duration=durations,
        loop=0,
        optimize=True,
        disposal=1,
    )
    print(
        f"  {out.relative_to(ROOT)}：{kept[0][1].width}×{kept[0][1].height}，{len(kept)} 帧，"
        f"一轮 {sum(durations)}ms，{out.stat().st_size} 字节",
        file=sys.stderr,
    )


def open_page(browser, theme: str):
    ctx = browser.new_context(
        viewport={"width": 1280, "height": VIEWPORT_H},
        device_scale_factor=SCALE,
        color_scheme=theme,
        locale="en-US",
    )
    page = ctx.new_page()
    page.goto(SITE_URL, wait_until="load", timeout=120_000)
    try:
        page.wait_for_load_state("networkidle", timeout=10_000)
    except PlaywrightTimeoutError:
        pass  # 页面上总有轮询和长连接在跑
    if theme == "dark":
        page.wait_for_selector("html.dark")
    page.add_style_tag(content="#dev-toggles, nextjs-portal { display: none !important; }")
    page.wait_for_timeout(3000)
    return page


def bring_into_view(page, selector: str) -> None:
    page.locator(selector).first.evaluate('el => el.scrollIntoView({ block: "center", behavior: "instant" })')
    page.wait_for_timeout(800)
    # 离屏推迟排版的块滚到视口才渲染，再等图片到位
    page.evaluate(
        """async () => {
          const imgs = [...document.images].filter((img) => {
            const r = img.getBoundingClientRect();
            return r.bottom > 0 && r.top < innerHeight && !img.complete;
          });
          await Promise.all(imgs.map((img) => new Promise((done) => { img.onload = img.onerror = done; setTimeout(done, 8000); })));
        }"""
    )
    page.wait_for_timeout(400)
    # 上面那步对加载失败也放行；卡片里有坏图就别录，不然 GIF 里留一个破图标（自建歌单封面是
    # 24 小时预签名地址，本机取图还可能被代理的 fake-IP 挡掉）
    broken = page.locator(selector).first.evaluate(
        "el => [...el.querySelectorAll('img')].filter((img) => img.complete && img.naturalWidth === 0).map((img) => img.alt || img.src)"
    )
    if broken:
        raise SystemExit(f"{selector} 里有图片没加载出来：{broken}")


def box_of(page, selector: str) -> dict[str, float]:
    box = page.locator(selector).first.bounding_box()
    if not box:
        raise SystemExit(f"没有元素命中 {selector}")
    return box


def union(*boxes: dict[str, float]) -> dict[str, float]:
    x0 = max(0.0, min(b["x"] for b in boxes) - PAD)
    y0 = max(0.0, min(b["y"] for b in boxes) - PAD)
    x1 = min(1280.0, max(b["x"] + b["width"] for b in boxes) + PAD)
    y1 = min(float(VIEWPORT_H), max(b["y"] + b["height"] for b in boxes) + PAD)
    return {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0}


def isolate(page, *selectors: str) -> None:
    """把目标之外的兄弟节点 visibility:hidden（布局不动），留白里才不会露出邻居卡片的边"""
    handles = [page.locator(sel).first.element_handle() for sel in selectors]
    page.evaluate(
        """(targets) => {
          const keep = new Set();
          for (const target of targets) for (let el = target; el; el = el.parentElement) keep.add(el);
          for (const el of keep) {
            const parent = el.parentElement;
            if (!parent) continue;
            for (const sib of parent.children) if (!keep.has(sib)) sib.style.visibility = "hidden";
          }
        }""",
        handles,
    )
    page.wait_for_timeout(200)


class Nudger:
    """换夹具后让卡片回源：dispatch focus，按 SWR 的节流间隔等够再触发"""

    def __init__(self, page):
        self.page = page
        self.last = float("-inf")

    def __call__(self, path: str, fixture: Path) -> None:
        override(path, str(fixture))
        self.page.wait_for_timeout(max(0.0, FOCUS_THROTTLE_S - (time.perf_counter() - self.last)) * 1000)
        self.page.evaluate("window.dispatchEvent(new Event('focus'))")
        self.last = time.perf_counter()


def variant(base: str | Path, tmp: Path, name: str, edit) -> Path:
    """从夹具（dev-fixtures 里的文件名，或任意路径）派生一份改过 data 的临时夹具（dev-override 认任意路径）"""
    fixture = json.loads((base if isinstance(base, Path) else FIXTURES / base).read_text())
    edit(fixture["data"])
    path = tmp / f"{name}.json"
    path.write_text(json.dumps(fixture, ensure_ascii=False))
    return path


def live_base(path: str, tmp: Path) -> Path:
    """没有夹具的端点：拿本地 Worker 此刻的响应当基线，新鲜度戳换成令牌免得录到一半过期"""
    with urllib.request.urlopen(f"{WORKER_URL}{path}", timeout=15) as response:
        envelope = json.load(response)
    if not envelope.get("ok"):
        raise SystemExit(f"{path} 此刻不可用，没法当基线：{envelope}")
    for key in ("pushedAt", "lastSeenAt"):
        if key in envelope["data"]:
            envelope["data"][key] = "$now"
    file = tmp / f"{path.strip('/').replace('/', '-')}-base.json"
    file.write_text(json.dumps(envelope, ensure_ascii=False))
    return file


def freeze_now(value, base_ms: int):
    """把 `$now-…` 令牌换成以 base_ms 为准的绝对毫秒；不带偏移的 `$now` 原样保留（那是新鲜度戳）"""
    if isinstance(value, str) and value.startswith("$now") and len(value) > 4:
        return base_ms + int(value[4:])
    if isinstance(value, list):
        return [freeze_now(item, base_ms) for item in value]
    if isinstance(value, dict):
        return {key: freeze_now(item, base_ms) for key, item in value.items()}
    return value


# ---- 场景 -------------------------------------------------------------------------------------

def scene_now_listening(browser, theme: str, tmp: Path) -> Recorder:
    """页面里的播放位置 = positionMs + (Date.now() − observedAt)，observedAt 是注入那一刻减 1 秒。
    先把页面摆好，再注入 positionMs=6000 的变体并回源，注入后 0.9 秒起录 7.6 秒：正好从
    第一句收尾（6300ms）录到「二人だけの空が広がる夜に」（8953–15148ms）整句扫完。"""
    sel = card("Recently Played")
    # 充电头 / 充电宝在场时它只占右边一列；清掉才是独占整行的样子，录完放回去
    override("/api/status/charger", "--clear")
    override("/api/status/powerbank", "--clear")
    page = open_page(browser, theme)
    bring_into_view(page, sel)
    clip = union(box_of(page, sel))
    isolate(page, sel)
    nudge = Nudger(page)
    seek = variant("listening-now-yoasobi.json", tmp, "listening-seek", lambda d: d["music"].__setitem__("positionMs", 6000))
    nudge("/api/status/listening/now", seek)
    pushed = nudge.last
    page.wait_for_timeout(max(0.0, 0.9 - (time.perf_counter() - pushed)) * 1000)
    rec = Recorder(page, clip)
    rec.start()
    rec.record(7.6)
    page.context.close()
    override("/api/status/charger", "charger-macbook-iphone.json")
    override("/api/status/powerbank", "powerbank-charging.json")
    return rec


def scene_swap(sel: str, path: str, base: str, edits: list, prepare=None, before=None, after=None) -> "callable":
    """换夹具驱动的场景：从 edits[0] 那份开始，依次换到后面几份，各录 1.8 秒的过渡再停 1.2 秒。
    prepare 先于每份 edit 作用在 data 上，几份变体共有的改动放这里；before / after 在开页前后跑，
    给需要清掉别的注入才出现的布局用。"""

    def scene(browser, theme: str, tmp: Path) -> Recorder:
        if before:
            before()
        page = open_page(browser, theme)
        nudge = Nudger(page)
        source = base(tmp) if callable(base) else base
        files = [
            variant(source, tmp, f"{path.strip('/').replace('/', '-')}-{index}", lambda d, e=edit: (prepare and prepare(d), e(d)))
            for index, edit in enumerate(edits)
        ]
        nudge(path, files[0])
        page.wait_for_timeout(1500)
        bring_into_view(page, sel)
        clip = union(box_of(page, sel))
        isolate(page, sel)
        rec = Recorder(page, clip)
        rec.start()
        rec.hold(900)  # 先让变化前的读数停一会儿，不然第一帧就在半路上
        for file in files[1:]:
            nudge(path, file)
            rec.wait_change()
            rec.record(1.8)
            rec.hold(1200)
        page.context.close()
        if after:
            after()
        return rec

    return scene


def edit_activity_morning(d: dict) -> None:
    d.update(moveKcal=212, exerciseMinutes=18, standHours=6, steps=5210, distanceMeters=3902, flightsClimbed=3)


HISTORY_BASE_MS = int(time.time() * 1000)


def freeze_charger_history(d: dict) -> None:
    """曲线的历史点冻成绝对时间（整个运行共用一个基准）：`$now-…` 令牌每次注入都按新的当下重算，
    第二份变体会带着整条平移过的曲线到达，和已累积的点对不上。新鲜度戳（updatedAt 等）照旧用令牌。"""
    d["history"] = [
        {**point, "t": HISTORY_BASE_MS if point["t"] == "$now" else point["t"]}
        for point in freeze_now(d["history"], HISTORY_BASE_MS)
    ]


def edit_charger(total: float, c1: float, c2: float, offset_ms: int):
    def edit(d: dict) -> None:
        d["totalPower"] = total
        for port, power in zip(d["ports"], (c1, c2)):
            port["power"] = power
            port["current"] = round(power / port["voltage"], 2)
        # 只在末尾接上这一档的新点
        d["history"] = [*d["history"], {"t": d["history"][-1]["t"] + offset_ms, "w": total}]

    return edit


def edit_server(cpu: float, rx: int, tx: int, mem: int):
    def edit(d: dict) -> None:
        d.update(cpuUsagePercent=cpu, networkRxBytesPerSec=rx, networkTxBytesPerSec=tx, memoryUsedBytes=mem)

    return edit


def edit_vibecoding(steps: int):
    """用量涨 steps 档：今日与总计的 Token、成本，会话数，以及第一条限额窗口的百分比"""

    def edit(d: dict) -> None:
        tokens, cost = 1_284_913 * steps, 1.27 * steps
        d["totals"]["totalTokens"] += tokens
        d["totals"]["outputTokens"] += tokens // 6
        d["totals"]["apiEquivalentCostUSD"] += cost
        d["totals"]["sessionCount"] += steps
        agent = d["agents"][0]
        agent["today"]["totalTokens"] += tokens
        agent["today"]["outputTokens"] += tokens // 6
        agent["today"]["apiEquivalentCostUSD"] += cost
        if agent.get("limits"):
            agent["limits"][0]["usedPercent"] = min(100, agent["limits"][0]["usedPercent"] + 2 * steps)

    return edit


SCENES = {
    "now-listening": scene_now_listening,
    "activity": scene_swap(card("Activity"), "/api/status/activity", "activity-afternoon.json", [edit_activity_morning, lambda d: None]),
    "charger": scene_swap(
        card("Charger"),
        "/api/status/charger",
        "charger-macbook-iphone.json",
        [lambda d: None, edit_charger(98.31, 72.42, 25.89, 20_000), edit_charger(123.64, 96.51, 27.13, 40_000)],
        prepare=freeze_charger_history,
        # 充电宝在场时充电头是紧凑布局，没有功率曲线；录的时候先把它清掉
        before=lambda: override("/api/status/powerbank", "--clear"),
        after=lambda: override("/api/status/powerbank", "powerbank-charging.json"),
    ),
    "server": scene_swap(
        card("Exit Node"),
        "/api/status/server",
        "server-traffic.json",
        [lambda d: None, edit_server(31.7, 2_884_000, 612_000, 702_545_920), edit_server(14.1, 1_198_000, 388_000, 655_360_000)],
    ),
    "vibecoding": scene_swap(
        "#vibe-coding",
        "/api/status/vibecoding",
        lambda tmp: live_base("/api/status/vibecoding", tmp),
        [lambda d: None, edit_vibecoding(1), edit_vibecoding(2)],
    ),
}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--theme", choices=["light", "dark"], action="append", help="默认明暗都生成")
    parser.add_argument("--scene", choices=list(SCENES), action="append", help="默认全部场景")
    args = parser.parse_args()
    themes = args.theme or ["light", "dark"]
    scenes = args.scene or list(SCENES)
    with tempfile.TemporaryDirectory(prefix="card-gifs-") as tmp_dir, sync_playwright() as p:
        tmp = Path(tmp_dir)
        browser = p.chromium.launch(channel=BROWSER_CHANNEL)
        for name in scenes:
            for theme in themes:
                print(f"录 {name} {theme}…", file=sys.stderr)
                rec = SCENES[name](browser, theme, tmp)
                write_gif(rec, OUT_DIR / f"{name}-{theme}.gif")
        browser.close()


if __name__ == "__main__":
    main()
