#!/usr/bin/env python3
"""把这台机器的 CPU / 内存 / 磁盘 / 网速推给 lyjwpage。

只依赖 Python 3 标准库。采集窗口就是上报间隔本身：上一轮 /proc 的读数留着，
这一轮做差，得到的是这段时间的平均占用和平均速率，不是「这一瞬间的尖峰」。

同一份差值还有第二个去处：累加成计费周期的流量，落在状态文件里跨进程、跨重启
接着数（见下面「流量统计」那节）。

跑在容器里时 `/proc` 拿到的本来就是宿主机的数（Docker 不虚拟化 /proc），CPU、内存、
负载、运行时间、内核都不用管；网卡那几项靠 `network_mode: host` 落在宿主机的网络
命名空间里。剩下三样容器内会看到自己那份 —— 系统名、主机名、根分区容量 ——
由 `HOST_ROOT` 指向宿主机挂进来的那份目录来纠正，见 README。
"""

from __future__ import annotations

import fcntl
from concurrent.futures import ThreadPoolExecutor
import json
import os
import re
import signal
import socket
import struct
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any

# 三档节奏。这份快照每轮必发（它本身就是心跳），30 秒一轮时它是站点函数调用量
# 最大的一条路径 —— 实测 12 小时 1.5K 次。而这些数字只在有人看的时候才有人看，
# 所以每轮收尾分别问两个 Worker 的 /count，拿到两个数，据此决定下一轮多久：
#
#   有人正看着（`online`，只数**可见**的页面）                      → 60 秒
#   页面开着但都在后台（`connections`，数**开着**的连接）           → 2 分钟
#   一个页面都没开                                                  → 15 分钟
#
# 中间那档是为「切走了但还会切回来」留的：手机锁屏、后台标签页在 `online`
# 里算 0（站点侧 use-online-count 在 visibilitychange 时整条关掉），但它随时会
# 被切回来，那一下不该看见十分钟前的 CPU。而事件推送那条连接不管可不可见都挂
# 着，正好是「开着本站」的口径。
#
# 三档和另外两个上报器逐档对齐（agent-limits-reporter、playstation-reporter），
# 同一个概念同一个数，别在三处各调各的。
#
# 慢档锚着站点的 SERVER_STALE_MS（lib/freshness，50 分钟 = 三轮 + 一个刷新周期的
# 余量）：改慢档必须同步改那边，改另外两档不用，判活的下限始终由慢档定。
# 卡片那侧仍是 30 秒一问（和充电头一档），比快档还勤 —— 多出来那一趟拿到的是同
# 一份数字，是有意留的：那是浏览器自己的节奏，不该由上报器的档位决定。
LIVE_INTERVAL_MS = 60_000
OPEN_INTERVAL_MS = 120_000
IDLE_INTERVAL_MS = 900_000
# 人头数读不回来不该拖着上报等。超时、非 200、形状不对，一律当 0 —— 兜底方向
# 是单向的：读不到只会往慢里退，永远不会因为故障变快。
COUNT_TIMEOUT_S = 2.5
PUSH_TIMEOUT_S = 10.0
GEO_TTL_S = 6 * 3600
# 流量状态文件。容器里是挂进来的卷（compose 的 ./server-reporter/data:/data）
TRAFFIC_STATE_PATH = "/data/traffic.json"
TRAFFIC_STATE_VERSION = 1
GEO_TIMEOUT_S = 5.0
USER_AGENT = "lyjwpage-server-reporter/1.0"
AS_LINE = re.compile(r"^AS(\d+)\s*(.*)$", re.IGNORECASE)


# ── 配置 ──────────────────────────────────────────────────


def required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"缺少环境变量 {name}")
    return value


def ms(name: str, fallback: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return fallback
    try:
        value = int(raw)
    except ValueError as error:
        raise SystemExit(f"{name} 必须是正整数") from error
    if value <= 0:
        raise SystemExit(f"{name} 必须是正整数")
    return value


def trim_slash(url: str) -> str:
    return url.rstrip("/")


def cycle_day() -> int:
    """计费周期从每月几号归零。29 之后不是每个月都有，直接不收。"""
    raw = os.environ.get("TRAFFIC_CYCLE_DAY", "").strip()
    if not raw:
        return 1
    try:
        day = int(raw)
    except ValueError as error:
        raise SystemExit("TRAFFIC_CYCLE_DAY 必须是 1–28 的整数") from error
    if not 1 <= day <= 28:
        raise SystemExit("TRAFFIC_CYCLE_DAY 必须是 1–28 的整数（29 之后不是每个月都有）")
    return day


def quota_bytes() -> int | None:
    """套餐给的周期流量，字节。没配就没有配额，卡片只报用量。"""
    raw = os.environ.get("TRAFFIC_QUOTA_BYTES", "").strip()
    if not raw:
        return None
    try:
        value = int(raw)
    except ValueError as error:
        raise SystemExit("TRAFFIC_QUOTA_BYTES 必须是正整数（字节）") from error
    if value <= 0:
        raise SystemExit("TRAFFIC_QUOTA_BYTES 必须是正整数（字节）")
    return value


def ingest_url() -> str:
    explicit = os.environ.get("SITE_INGEST_URL", "").strip()
    if explicit:
        return explicit
    return f"{trim_slash(required('SITE_URL'))}/api/ingest/server"


def count_url(variable: str) -> str:
    """分别从 API 与在线人数 Worker 的源拼接公开计数口。"""
    origin = os.environ.get(variable, "").strip()
    return f"{trim_slash(origin)}/count" if origin else ""


# 容器里宿主机 /etc 的挂载点（compose 里是 /host/etc，只读）。留空 = 直接跑在宿主机上。
HOST_ROOT = os.environ.get("HOST_ROOT", "").strip().rstrip("/")

CONFIG = {
    "ingest_url": ingest_url(),
    "secret": os.environ.get("TELEMETRY_INGEST_SECRET", "").strip(),
    "host_id": os.environ.get("HOST_ID", "").strip() or "misaka-jp",
    "location": os.environ.get("HOST_LOCATION", "").strip() or "Tokyo",
    "live_interval_s": ms("LIVE_INTERVAL_MS", LIVE_INTERVAL_MS) / 1000,
    "open_interval_s": ms("OPEN_INTERVAL_MS", OPEN_INTERVAL_MS) / 1000,
    "idle_interval_s": ms("IDLE_INTERVAL_MS", IDLE_INTERVAL_MS) / 1000,
    "count_url": count_url("SITE_URL"),
    "online_count_url": count_url("ONLINE_COUNTER_URL"),
    "count_timeout_s": ms("COUNT_TIMEOUT_MS", int(COUNT_TIMEOUT_S * 1000)) / 1000,
    "push_timeout_s": ms("PUSH_TIMEOUT_MS", int(PUSH_TIMEOUT_S * 1000)) / 1000,
    # 留空 = 不攒流量（没有能写的地方时的明确选择），这一份就不报 traffic
    "traffic_state_path": os.environ.get("TRAFFIC_STATE_PATH", TRAFFIC_STATE_PATH).strip(),
    "cycle_day": cycle_day(),
    "quota_bytes": quota_bytes(),
}


# ── 日志 ──────────────────────────────────────────────────
# 和另外两份 Node 上报器同一套规矩：同一个环节连续出错只在第一次和恢复时
# 各说一句，中间每满 10 次再报一次，免得 journal 被同一条「连接被拒绝」刷满。

_streaks: dict[str, int] = {}


def stamp() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def info(message: str) -> None:
    print(f"{stamp()} {message}", flush=True)


def failure(scope: str, error: BaseException | str) -> None:
    count = _streaks.get(scope, 0) + 1
    _streaks[scope] = count
    reason = str(error)
    if count == 1 or count % 10 == 0:
        extra = f"（连续第 {count} 次）" if count > 1 else ""
        print(f"{stamp()} [{scope}] {reason}{extra}", file=sys.stderr, flush=True)


def recovered(scope: str) -> None:
    if not _streaks.get(scope):
        return
    print(f"{stamp()} [{scope}] 恢复正常", flush=True)
    _streaks.pop(scope, None)


# ── 采集 ──────────────────────────────────────────────────


def read_os() -> str:
    pretty = ""
    try:
        with open(f"{HOST_ROOT}/etc/os-release", encoding="utf-8") as handle:
            for line in handle:
                if line.startswith("PRETTY_NAME="):
                    pretty = line.split("=", 1)[1].strip().strip('"')
                    break
    except OSError:
        pass
    return pretty or os.uname().sysname


def cpu_times() -> tuple[int, int]:
    """返回 (idle+iowait, 总 jiffies)。guest 已经含在 user 里，不算进总和。"""
    with open("/proc/stat", encoding="utf-8") as handle:
        parts = handle.readline().split()
    nums = [int(item) for item in parts[1:9]]
    idle = nums[3] + (nums[4] if len(nums) > 4 else 0)
    return idle, sum(nums)


def mem_bytes() -> tuple[int, int, int]:
    info_map: dict[str, int] = {}
    with open("/proc/meminfo", encoding="utf-8") as handle:
        for line in handle:
            key, value, *_rest = line.split()
            info_map[key.rstrip(":")] = int(value) * 1024
    total = info_map["MemTotal"]
    available = info_map["MemAvailable"]
    return total, total - available, available


def hostname() -> str:
    """容器里 gethostname() 是容器 ID，读宿主机挂进来的 /etc/hostname 才是真名。"""
    if HOST_ROOT:
        try:
            with open(f"{HOST_ROOT}/etc/hostname", encoding="utf-8") as handle:
                name = handle.readline().strip()
            if name:
                return name
        except OSError:
            pass
    return socket.gethostname()


def disk_bytes(path: str = "") -> tuple[int, int]:
    """根分区容量。容器里 statvfs("/") 量的是 overlay，改量宿主机 /etc 所在的那块盘。"""
    target = path or (f"{HOST_ROOT}/etc" if HOST_ROOT else "/")
    stat = os.statvfs(target)
    total = stat.f_frsize * stat.f_blocks
    used = total - stat.f_frsize * stat.f_bfree
    return total, used


def loadavg() -> tuple[float, float, float]:
    with open("/proc/loadavg", encoding="utf-8") as handle:
        parts = handle.readline().split()
    return float(parts[0]), float(parts[1]), float(parts[2])


def uptime_seconds() -> float:
    with open("/proc/uptime", encoding="utf-8") as handle:
        return float(handle.readline().split()[0])


def default_iface() -> str:
    """默认路由那块网卡。lo 和没配地址的虚拟口都不算。"""
    with open("/proc/net/route", encoding="utf-8") as handle:
        next(handle)
        for line in handle:
            fields = line.split()
            if len(fields) >= 2 and fields[1] == "00000000":
                return fields[0]
    raise RuntimeError("找不到默认路由网卡")


def iface_ipv4(iface: str) -> str:
    """默认网卡上的 IPv4。这台落地节点的公网地址就配在这块卡上。"""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        packed = struct.pack("256s", iface.encode("utf-8")[:15])
        return socket.inet_ntoa(fcntl.ioctl(sock.fileno(), 0x8915, packed)[20:24])
    finally:
        sock.close()


def http_json(url: str, timeout: float) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8", errors="replace"))
    if not isinstance(payload, dict):
        raise RuntimeError("geo 接口返回的不是对象")
    return payload


def parse_as(raw: str) -> tuple[int | None, str | None]:
    match = AS_LINE.match(raw.strip())
    if not match:
        return None, None
    org = match.group(2).strip() or None
    return int(match.group(1)), org


def text_or_none(value: object) -> str | None:
    if value is None:
        return None
    trimmed = str(value).strip()
    return trimmed or None


def lookup_ip_sb(ip: str) -> dict[str, Any]:
    row = http_json(f"https://api.ip.sb/geoip/{ip}", GEO_TIMEOUT_S)
    asn_raw = row.get("asn")
    asn = None
    if isinstance(asn_raw, int) and asn_raw > 0:
        asn = asn_raw
    elif isinstance(asn_raw, str) and asn_raw.isdigit():
        parsed = int(asn_raw)
        if parsed > 0:
            asn = parsed
    org = row.get("asn_organization") or row.get("organization")
    isp = row.get("isp") or org
    return {
        "country": text_or_none(row.get("country")),
        "city": text_or_none(row.get("city")),
        "isp": str(isp).strip() if isp else None,
        "asn": asn if asn and asn > 0 else None,
        "asnOrg": str(org).strip() if org else None,
    }


def lookup_ip_api(ip: str) -> dict[str, Any]:
    row = http_json(
        f"http://ip-api.com/json/{ip}?fields=status,message,country,city,isp,org,as",
        GEO_TIMEOUT_S,
    )
    if row.get("status") != "success":
        raise RuntimeError(str(row.get("message") or "ip-api 失败"))
    asn, as_org = parse_as(str(row.get("as") or ""))
    org = as_org or (str(row["org"]).strip() if row.get("org") else None)
    isp = str(row["isp"]).strip() if row.get("isp") else org
    return {
        "country": text_or_none(row.get("country")),
        "city": text_or_none(row.get("city")),
        "isp": isp or None,
        "asn": asn,
        "asnOrg": org,
    }


_geo: dict[str, Any] = {"ip": "", "at": 0.0}


def geo_for(ip: str) -> dict[str, Any]:
    """查 Location / ISP / ASN。结果按 IP 缓存几小时，地址没变就不打上游。"""
    now = time.time()
    if _geo["ip"] == ip and now - _geo["at"] < GEO_TTL_S:
        return _geo

    try:
        found = lookup_ip_sb(ip)
        recovered("geo")
    except Exception as error:
        failure("geo", error)
        try:
            found = lookup_ip_api(ip)
            recovered("geo")
        except Exception as fallback:
            failure("geo", fallback)
            if _geo["ip"] == ip:
                return _geo
            found = {
                "country": None,
                "city": CONFIG["location"] or None,
                "isp": None,
                "asn": None,
                "asnOrg": None,
            }

    _geo.clear()
    _geo.update(found)
    _geo["ip"] = ip
    _geo["at"] = now
    return _geo


def net_bytes(iface: str) -> tuple[int, int]:
    token = f"{iface}:"
    with open("/proc/net/dev", encoding="utf-8") as handle:
        for line in handle:
            stripped = line.lstrip()
            if not stripped.startswith(token):
                continue
            parts = stripped.split()
            # iface: rx_bytes ... tx_bytes 在 split 之后下标 1 和 9
            return int(parts[1]), int(parts[9])
    raise RuntimeError(f"网卡 {iface} 不在 /proc/net/dev 里")


# ── 流量统计 ──────────────────────────────────────────────
# `/proc/net/dev` 的计数器只从开机算起，一重启就归零，「这个计费周期用了多少」
# 得自己攒。每轮把两次读数之差累加进当前周期，连同游标原子写回状态文件：进程
# 重启、机器重启都接着上次数下去，不从头再来。
#
# 计数器归零的判据是「这次比游标小」—— 重启后网卡从 0 开始，那一段就是当前读数
# 本身。而从没攒过的那一轮只记游标、不计流量：一台开机 200 天的机器第一次跑起
# 来，计数器里那几个 T 是过去几个月的，不该一股脑算进这个周期。
#
# 那一轮有个例外：开机时刻**落在这个周期之内**时，计数器里的每一个字节都是这个
# 周期走的，整份接管过来就是准的。第一次装上去不用干等到下个月 1 号才有数。
#
# 周期是 UTC 的自然月，起始日由 `TRAFFIC_CYCLE_DAY` 定（跟着套餐的账单日，不是
# 非得 1 号）。跨周期那一轮的增量整段算进新周期 —— 边界上最多差一个上报间隔，
# 而按秒把它劈成两半要假设这段时间流量是匀速的，那个假设比这点误差更假。
#
# 攒得住才报：状态文件一次都没写成功过（卷是只读、目录没给写权限）就报 null，
# 卡片上少一块，好过默默显示一个只从本次进程算起的小数。


def shift_month(moment: datetime, months: int) -> datetime:
    """同一个「几号」往前后挪几个月。日 ≤ 28，落在哪个月都存在。"""
    index = moment.year * 12 + moment.month - 1 + months
    return moment.replace(year=index // 12, month=index % 12 + 1)


def cycle_bounds(now_s: float, day: int) -> tuple[int, int]:
    """当前计费周期的 [起, 止)，epoch 毫秒。止就是下一周期的起。"""
    now = datetime.fromtimestamp(now_s, timezone.utc)
    anchor = now.replace(day=day, hour=0, minute=0, second=0, microsecond=0)
    start = anchor if now >= anchor else shift_month(anchor, -1)
    return int(start.timestamp() * 1000), int(shift_month(start, 1).timestamp() * 1000)


def accumulate(
    state: dict[str, Any],
    iface: str,
    rx: int,
    tx: int,
    now_s: float,
    day: int,
    boot_ms: int | None = None,
) -> dict[str, Any]:
    """把这一轮的增量并进周期累计，返回新状态。纯函数，可单测。"""
    start, end = cycle_bounds(now_s, day)
    same_iface = state.get("interface") == iface
    # 换网卡：新计数器和上一块无关，累计和游标一起作废，从这一轮重新数
    carry = same_iface and state.get("cycleStart") == start
    rx_total = int(state.get("rxBytes", 0)) if carry else 0
    tx_total = int(state.get("txBytes", 0)) if carry else 0
    rx_cursor = state.get("rxCursor")
    tx_cursor = state.get("txCursor")
    if same_iface and isinstance(rx_cursor, int) and isinstance(tx_cursor, int):
        rx_total += rx - rx_cursor if rx >= rx_cursor else rx
        tx_total += tx - tx_cursor if tx >= tx_cursor else tx
    elif not state and boot_ms is not None and boot_ms >= start:
        # 头一回攒，而这台机器是这个周期之内开的：计数器里的字节全是这个周期的，
        # 整份接管。只认「一份状态都没有」这一种情况 —— 换网卡时旧卡那段已经数
        # 过了，再按开机时刻接管一次就是重复计数
        rx_total, tx_total = rx, tx
    return {
        "version": TRAFFIC_STATE_VERSION,
        "interface": iface,
        "cycleStart": start,
        "cycleEnd": end,
        "rxBytes": rx_total,
        "txBytes": tx_total,
        "rxCursor": rx,
        "txCursor": tx,
        "updatedAt": int(now_s * 1000),
    }


_traffic: dict[str, Any] = {"state": {}, "loaded": False, "durable": False}


def load_traffic_state() -> None:
    """进程起来后读一次。读不出来不是致命的，这个周期从零重新数。"""
    _traffic["loaded"] = True
    path = CONFIG["traffic_state_path"]
    if not path:
        return
    try:
        with open(path, encoding="utf-8") as handle:
            state = json.load(handle)
    except FileNotFoundError:
        return  # 第一次跑，等这一轮写出来
    except (OSError, ValueError) as error:
        failure("traffic-state", f"读不出 {path}，这个周期从零开始数：{error}")
        return
    if not isinstance(state, dict) or state.get("version") != TRAFFIC_STATE_VERSION:
        failure("traffic-state", f"{path} 不是这一版的状态，丢掉重新数")
        return
    _traffic["state"] = state
    # 读得出上次那份就说明这条路是通的，攒的数能接着用
    _traffic["durable"] = True


def save_traffic_state(state: dict[str, Any]) -> bool:
    """原子写回：先落临时文件再 replace，断电不会留下半截 JSON。"""
    path = CONFIG["traffic_state_path"]
    if not path:
        return False
    temp = f"{path}.tmp"
    try:
        parent = os.path.dirname(path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        with open(temp, "w", encoding="utf-8") as handle:
            json.dump(state, handle, separators=(",", ":"))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, path)
        recovered("traffic-state")
        return True
    except OSError as error:
        failure("traffic-state", f"写不进 {path}，这一份不报流量：{error}")
        return False


def traffic_for(
    iface: str, rx: int, tx: int, now_s: float, boot_ms: int | None = None
) -> dict[str, Any] | None:
    if not _traffic["loaded"]:
        load_traffic_state()
    state = accumulate(
        _traffic["state"], iface, rx, tx, now_s, CONFIG["cycle_day"], boot_ms
    )
    _traffic["state"] = state
    if save_traffic_state(state):
        _traffic["durable"] = True
    if not _traffic["durable"]:
        return None
    return {
        "cycleStart": state["cycleStart"],
        "cycleEnd": state["cycleEnd"],
        "rxBytes": state["rxBytes"],
        "txBytes": state["txBytes"],
        "quotaBytes": CONFIG["quota_bytes"],
    }


def cpu_percent(prev: tuple[int, int], cur: tuple[int, int]) -> float:
    idle_delta = cur[0] - prev[0]
    total_delta = cur[1] - prev[1]
    if total_delta <= 0:
        return 0.0
    used = 1.0 - idle_delta / total_delta
    return max(0.0, min(100.0, used * 100.0))


def snapshot(
    iface: str,
    prev_cpu: tuple[int, int],
    prev_net: tuple[int, int],
    prev_at: float,
) -> dict[str, Any]:
    now = time.time()
    cur_cpu = cpu_times()
    cur_net = net_bytes(iface)
    elapsed = max(now - prev_at, 1e-6)
    rx, tx = cur_net
    prev_rx, prev_tx = prev_net
    uptime_s = uptime_seconds()
    memory_total, memory_used, memory_available = mem_bytes()
    disk_total, disk_used = disk_bytes()
    load1, load5, load15 = loadavg()
    uname = os.uname()
    public_ip = iface_ipv4(iface)
    geo = geo_for(public_ip)
    return {
        "version": 1,
        "id": CONFIG["host_id"],
        "hostname": hostname(),
        "publicIp": public_ip,
        "country": geo.get("country"),
        "city": geo.get("city") or CONFIG["location"] or None,
        "isp": geo.get("isp"),
        "asn": geo.get("asn"),
        "asnOrg": geo.get("asnOrg"),
        "os": read_os(),
        "kernel": uname.release,
        "cpuCores": os.cpu_count() or 1,
        "cpuUsagePercent": round(cpu_percent(prev_cpu, cur_cpu), 1),
        "load1": round(load1, 2),
        "load5": round(load5, 2),
        "load15": round(load15, 2),
        "memoryTotalBytes": memory_total,
        "memoryUsedBytes": memory_used,
        "memoryAvailableBytes": memory_available,
        "diskTotalBytes": disk_total,
        "diskUsedBytes": disk_used,
        "networkInterface": iface,
        "networkRxBytes": rx,
        "networkTxBytes": tx,
        "networkRxBytesPerSec": max(0, (rx - prev_rx) / elapsed),
        "networkTxBytesPerSec": max(0, (tx - prev_tx) / elapsed),
        "traffic": traffic_for(iface, rx, tx, now, int((now - uptime_s) * 1000)),
        "uptimeSeconds": round(uptime_s),
        "observedAt": int(now * 1000),
        "_cursor": {"cpu": cur_cpu, "net": cur_net, "at": now},
    }


# ── 推送 ──────────────────────────────────────────────────


def push(payload: dict[str, Any]) -> None:
    body = json.dumps(
        {key: value for key, value in payload.items() if key != "_cursor"},
        separators=(",", ":"),
    ).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": USER_AGENT,
    }
    if CONFIG["secret"]:
        headers["Authorization"] = f"Bearer {CONFIG['secret']}"
    request = urllib.request.Request(
        CONFIG["ingest_url"],
        data=body,
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=CONFIG["push_timeout_s"]) as response:
            raw = response.read().decode("utf-8", errors="replace")
            try:
                envelope = json.loads(raw)
            except json.JSONDecodeError as error:
                raise RuntimeError(f"站点返回 {response.status}：不是合法 JSON") from error
            if not isinstance(envelope, dict) or envelope.get("ok") is not True:
                reason = envelope.get("error") if isinstance(envelope, dict) else None
                extra = f"：{reason}" if reason else ""
                raise RuntimeError(f"站点返回 {response.status}{extra}")
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        try:
            envelope = json.loads(raw)
            reason = envelope.get("error") if isinstance(envelope, dict) else None
        except json.JSONDecodeError:
            reason = raw[:200]
        extra = f"：{reason}" if reason else ""
        raise RuntimeError(f"站点返回 {error.code}{extra}") from error


# ── 主循环 ────────────────────────────────────────────────


def head_count(url: str, field: str) -> int:
    if not url:
        return 0
    scope = f"head-count-{field}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=CONFIG["count_timeout_s"]) as response:
            body = json.loads(response.read().decode("utf-8", errors="replace"))
        value = body[field]
        if type(value) is not int or value < 0:
            raise ValueError(f"invalid {field}")
        recovered(scope)
        return value
    except Exception as error:
        failure(scope, error)
        return 0


def head_counts() -> tuple[int, int]:
    """两个计数口并行读取，一端失败不影响另一端。"""
    with ThreadPoolExecutor(max_workers=2) as pool:
        online = pool.submit(head_count, CONFIG["online_count_url"], "online")
        connections = pool.submit(head_count, CONFIG["count_url"], "connections")
        return online.result(), connections.result()


def next_delay() -> float:
    """下一轮多久之后。可见 → 快档，只是开着 → 中档，都没有 → 慢档。"""
    online, connections = head_counts()
    if online > 0:
        return CONFIG["live_interval_s"]
    if connections > 0:
        return CONFIG["open_interval_s"]
    return CONFIG["idle_interval_s"]


def wait_for_next_round(stopping: "Callable[[], bool]") -> None:
    """等到下一轮。

    长档不是一觉睡满：拆成一个个快档长度的小觉，每觉醒来重新问一次人头数，
    该走更快那档了就立刻回去开跑。否则「从没人到有人正看着」最坏要等满一个慢档
    （15 分钟），而那正是有人盯着屏幕等的那一刻。多打的那几次是自家的
    API Worker，不是这台机器的 /proc。
    """
    delay = next_delay()
    deadline = time.time() + delay
    while not stopping():
        left = deadline - time.time()
        if left <= 0:
            return
        nap = min(CONFIG["live_interval_s"], left)
        napped_until = time.time() + nap
        while not stopping() and time.time() < napped_until:
            time.sleep(min(0.5, napped_until - time.time()))
        if stopping() or time.time() >= deadline:
            return
        if next_delay() < delay:
            return


def main() -> None:
    info(
        f"server-reporter 启动：{CONFIG['host_id']} ({CONFIG['location']}) → {CONFIG['ingest_url']}"
    )
    if not CONFIG["secret"]:
        info("没配 TELEMETRY_INGEST_SECRET —— 只有站点也没配时才可以这样")

    iface = default_iface()
    gears = (
        f"{CONFIG['live_interval_s']:.0f}s / {CONFIG['open_interval_s']:.0f}s"
        f" / {CONFIG['idle_interval_s']:.0f}s"
    )
    info(
        f"网卡 {iface}，间隔 {gears}（有人看 / 开着 / 都没有）"
        + ("" if CONFIG["count_url"] else "，没配 SITE_URL 读不到人头数，只走最慢那档")
    )
    if CONFIG["traffic_state_path"]:
        quota = CONFIG["quota_bytes"]
        info(
            f"流量每月 {CONFIG['cycle_day']} 号归零，状态存 {CONFIG['traffic_state_path']}"
            + (f"，配额 {quota} 字节" if quota else "，没配配额")
        )
    else:
        info("TRAFFIC_STATE_PATH 留空，不攒流量，这张卡上不显示那一栏")

    prev_cpu = cpu_times()
    prev_net = net_bytes(iface)
    prev_at = time.time()
    # 先采 1 秒做出第一份，卡片不必干等到一个完整间隔
    time.sleep(1)

    stopping = False

    def stop(signum: int, _frame: object) -> None:
        nonlocal stopping
        stopping = True
        info(f"收到 {signal.Signals(signum).name}，退出")

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    backoff = CONFIG["live_interval_s"]
    while not stopping:
        try:
            payload = snapshot(iface, prev_cpu, prev_net, prev_at)
            cursor = payload["_cursor"]
            push(payload)
            recovered("push")
            prev_cpu = cursor["cpu"]
            prev_net = cursor["net"]
            prev_at = cursor["at"]
            backoff = CONFIG["live_interval_s"]
            # 问人数排在推送之后：站点先拿到这一轮的数，再决定下一轮多久。
            # None = 走正常那条等待（会在等待中途重新问），不是退避
            delay = None
        except Exception as error:  # noqa: BLE001 — 这一轮作废，进程不退
            failure("push", error)
            delay = backoff
            backoff = min(backoff * 2, 5 * 60)

        if delay is None:
            wait_for_next_round(lambda: stopping)
        else:
            # 上一轮出错：按退避表等，这段时间不问人头数（问了也改变不了退避）
            deadline = time.time() + delay
            while not stopping and time.time() < deadline:
                time.sleep(min(0.5, deadline - time.time()))


if __name__ == "__main__":
    main()
