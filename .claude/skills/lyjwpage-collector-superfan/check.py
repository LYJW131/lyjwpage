#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import re
import statistics
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

STATE_DIR = os.environ.get("SUPERFAN_DIR", "/mnt/project-files/superfan-collector")
BASE = os.environ.get("SUPERFAN_BASE", "https://lyjw.me")
HERE = os.path.dirname(os.path.abspath(__file__))
QUERY_FILE = os.path.join(HERE, "errors-query.js")
HOUR = 3_600_000
FIRST_WINDOW_MS = 24 * HOUR
MAIN_LAG_MS = 2 * HOUR

# 一天 4 轮，取约 3 天的份数：内容哈希连续这么多份（含本轮）不变、updatedAt 却在走，才算冻住；状态文件每个视图也只留这么多份。
FROZEN_RUNS = 12
DROP_LOOKBACK = 3

# 每个视图由 collector 的哪些任务写，见 workers/collector/README.md「任务」。
VIEWS = {
    "agent-status": ["provider-status"],
    "github-chart": ["github-chart"],
    "github-repo": ["github-repo"],
    "cloudflare-workers": ["cloudflare-deployments", "cloudflare-metrics"],
    "site-deployments": ["site-deployments", "site-analytics", "pagespeed"],
    "health": ["site-health"],
    "digest": ["digest"],
    "listening": ["apple-recent"],
}

# 跟着 main 变的部分：冻住期间 main 有新提交才算本该变。其他 Worker 的部署只在它自己发布时变，这里看不出，不判冻住。
FROZEN_NEEDS_MAIN_MOVE = {"github-repo", "site-deployments.production", "cloudflare-workers.site.deployment"}


def _workers(snap):
    names = snap.get("workers")
    return len(names) if isinstance(names, list) else None


def _pagespeed(kind):
    return lambda snap: (snap.get("pagespeed") or {}).get(kind)


DROP_METRICS = [
    ("agent-status", "agents", "厂商数", lambda snap: snap.get("agents")),
    ("cloudflare-workers", "workers", "Worker 数", _workers),
    ("site-deployments", "pageviews", "访问量", lambda snap: snap.get("pageviews")),
    ("site-deployments", "pagespeed.desktop", "PageSpeed 桌面分", _pagespeed("desktop")),
    ("site-deployments", "pagespeed.mobile", "PageSpeed 手机分", _pagespeed("mobile")),
]

# 签名规则与 errors-query.js#SIGNATURE_RULES 是同一份，signature-vectors.json 两边的测试都跑；改一边同改另一边。
SIGNATURE_CHARS = 120
SAMPLE_CHARS = 4000
SIGNATURE_RULES = [
    (re.compile(r"[ \t\n\r\f\v]+"), " "),
    (re.compile(r"([^ ?])\?[^ \"'<>]+"), r"\1?<q>"),
    (re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"), "<uuid>"),
    (re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\.[0-9]+)?)?(?:Z|[+-][0-9]{2}:?[0-9]{2})?"), "<time>"),
    (re.compile(r"(\.[cm]?js):[0-9]+:[0-9]+"), r"\1:<n>:<n>"),
    (re.compile(r"-[A-Za-z0-9_-]{8}\.js"), "-<hash>.js"),
    (re.compile(r"[0-9A-Za-z]{16,}"), lambda m: "<id>" if len(re.findall(r"[0-9]", m.group())) >= 4 else m.group()),
    (re.compile(r"[0-9]{10,}"), "<n>"),
]
CLOSED = ("resolved", "fixed")


class StateError(Exception):
    pass


def signature(service, message, status=None):
    text = message
    if isinstance(status, (int, float)) and not isinstance(status, bool):
        text = f"{message} {int(status) if float(status).is_integer() else status}"
    for pattern, repl in SIGNATURE_RULES:
        text = pattern.sub(repl, text)
    return f"{service}: {text.strip(' ')[:SIGNATURE_CHARS]}"


def signature_hash(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]


def load_state(path):
    if not os.path.exists(path):
        return {"lastRunAt": None, "snapshots": {}, "ledger": []}
    try:
        with open(path, encoding="utf-8") as f:
            state = json.load(f)
    except (OSError, ValueError) as e:
        raise StateError(f"状态文件读不了：{path}：{e}") from e
    if not isinstance(state, dict):
        raise StateError(f"状态文件不是对象：{path}")
    return state


def get(path):
    req = urllib.request.Request(BASE + path, headers={"User-Agent": "lyjwpage collector-superfan"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, json.loads(r.read().decode("utf-8"))


def thresholds(repo):
    src = subprocess.run(["git", "-C", repo, "show", "origin/main:shared/freshness.ts"], capture_output=True, text=True, check=True).stdout
    out = {}
    for name, expr in re.findall(r"export const (\w+_STALE_MS)\s*=\s*([\d_\s*+]+);", src):
        out[name] = eval(expr.replace("_", ""), {"__builtins__": {}})
    return out


def main_head(repo):
    line = subprocess.run(["git", "-C", repo, "log", "-1", "--format=%H %ct", "origin/main"], capture_output=True, text=True, check=True).stdout.split()
    return line[0], int(line[1]) * 1000


def content(x):
    if isinstance(x, dict):
        return {k: content(v) for k, v in x.items() if not (k.endswith("At") or k in ("start", "end", "windowStart", "windowEnd"))}
    if isinstance(x, list):
        return [content(v) for v in x]
    return x


def digest(x):
    return hashlib.sha1(json.dumps(content(x), sort_keys=True).encode()).hexdigest()[:12]


def age(now, at):
    return now - at if isinstance(at, (int, float)) else None


def fmt(ms):
    if ms is None:
        return "无时间戳"
    return f"{ms / 60_000:.0f} 分钟" if ms < 2 * HOUR else f"{ms / HOUR:.1f} 小时"


def _number(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def _plain(x):
    return str(int(x)) if float(x).is_integer() else f"{x:.1f}"


def _should_change(key, since, main_at, now):
    if key in FROZEN_NEEDS_MAIN_MOVE:
        return _number(since) and _number(main_at) and since < main_at < now - MAIN_LAG_MS
    return not key.endswith(".deployment")


def frozen_findings(history, current, main_at, now):
    out = []
    for view, cur in current.items():
        series = (history.get(view) or [])[-(FROZEN_RUNS - 1):] + [cur]
        if len(series) < FROZEN_RUNS:
            continue
        stamps = [s.get("updatedAt") for s in series if _number(s.get("updatedAt"))]
        if stamps and max(stamps) == min(stamps):
            continue
        since = series[0].get("at") or series[0].get("updatedAt")
        parts = cur.get("parts")
        candidates = (
            [(f"{view}.{part}", part, lambda s, p=part, h=h: (s.get("parts") or {}).get(p) == h) for part, h in parts.items()]
            if isinstance(parts, dict) and parts
            else [(view, None, lambda s, h=cur.get("hash"): s.get("hash") == h)]
        )
        for key, part, same in candidates:
            if not all(same(s) for s in series) or not _should_change(key, since, main_at, now):
                continue
            note = "，期间 main 有新提交" if key in FROZEN_NEEDS_MAIN_MOVE else ""
            out.append({
                "view": view,
                "jobs": VIEWS.get(view, []),
                "level": "warn",
                "msg": f"{part + ' ' if part else '内容'}连续 {FROZEN_RUNS} 份快照哈希没变，updatedAt 在走{note}",
                "kind": "frozen",
                "part": part,
                "since": since,
            })
    return out


def drop_findings(history, current):
    out = []
    for view, metric, label, read in DROP_METRICS:
        if view not in current:
            continue
        now_value = read(current[view])
        before = [v for v in (read(s) for s in (history.get(view) or [])[-DROP_LOOKBACK:]) if _number(v)]
        if not _number(now_value) or not before:
            continue
        base = statistics.median(before)
        if base > 0 and now_value < base / 2:
            out.append({
                "view": view,
                "jobs": VIEWS.get(view, []),
                "level": "warn",
                "msg": f"{label}从 {_plain(base)} 掉到 {_plain(now_value)}（前 {len(before)} 份中位数），掉了一半以上",
                "kind": "drop",
                "metric": metric,
            })
    return out


def next_snapshots(history, current):
    out = {}
    for view in VIEWS:
        series = list(history.get(view) or [])
        if view in current:
            series.append(current[view])
        if series:
            out[view] = series[-FROZEN_RUNS:]
    return out


def check(repo, state):
    now = int(time.time() * 1000)
    th = thresholds(repo)
    head, head_at = main_head(repo)
    findings, snap = [], {}

    def add(view, level, msg):
        findings.append({"view": view, "jobs": VIEWS.get(view, []), "level": level, "msg": msg})

    def stale(view, label, at, key):
        limit = th.get(key)
        a = age(now, at)
        if limit and (a is None or a > limit):
            add(view, "warn", f"{label} 已 {fmt(a)} 没更新（阈值 {fmt(limit)}，{key}）")

    data = {}
    for view in VIEWS:
        try:
            status, body = get(f"/api/status/{view}")
        except urllib.error.HTTPError as e:
            add(view, "alert", f"端点返回 HTTP {e.code}")
            continue
        except Exception as e:
            add(view, "alert", f"端点读不到：{str(e)[:160]}")
            continue
        if not body.get("ok"):
            add(view, "alert", f"端点 ok=false：{json.dumps(body, ensure_ascii=False)[:160]}")
            continue
        data[view] = body
        inner = body.get("data")
        updated = body.get("updatedAt")
        if updated is None and isinstance(inner, dict):
            updated = inner.get("fetchedAt")
        snap[view] = {"hash": digest(inner), "updatedAt": updated, "at": now}

    d = data.get("agent-status", {}).get("data")
    if d:
        stale("agent-status", "厂商状态", d.get("fetchedAt"), "AGENT_STATUS_STALE_MS")
        bad = [a["id"] for a in d.get("agents", []) if a.get("stale")]
        if bad:
            add("agent-status", "warn", f"这几家沿用上一轮（stale）：{', '.join(bad)}")
        snap["agent-status"]["agents"] = len(d.get("agents", []))

    d = data.get("github-chart")
    if d:
        stale("github-chart", "贡献日历", d.get("updatedAt"), "GITHUB_CHART_STALE_MS")

    d = data.get("github-repo", {}).get("data")
    if d:
        stale("github-repo", "仓库统计", d.get("fetchedAt"), "GITHUB_REPO_STALE_MS")
        a = age(now, d.get("totalsAt"))
        if a is not None and a > 24 * HOUR:
            add("github-repo", "warn", f"增删行总数已沿用 {fmt(a)}（GitHub 统计一直没就绪）")
        top = (d.get("recentCommits") or [{}])[0].get("oid")
        lag = age(now, head_at)
        if top != head and lag > MAIN_LAG_MS:
            add("github-repo", "warn", f"「最近提交」第一条是 {str(top)[:7]}，main 已在 {head[:7]}（{fmt(lag)}前）")

    d = data.get("site-deployments", {}).get("data")
    if d:
        stale("site-deployments", "站点部署", d.get("fetchedAt"), "SITE_DEPLOYMENTS_STALE_MS")
        prod = d.get("production") or {}
        if prod.get("state") != "READY":
            add("site-deployments", "alert", f"生产部署状态是 {prod.get('state')}")
        failed = [
            r for r in d.get("recent", [])
            if r.get("state") not in ("READY", "BUILDING", "QUEUED", "INITIALIZING") and (r.get("createdAt") or 0) > (prod.get("createdAt") or 0)
        ]
        for r in failed:
            add("site-deployments", "warn", f"最近一次构建 {r.get('state')}：{(r.get('commit') or {}).get('sha', '')[:7]} {(r.get('commit') or {}).get('message', '')[:60]}")
        an = d.get("analytics") or {}
        stale("site-deployments", "访问量（site-analytics）", an.get("fetchedAt"), "SITE_ANALYTICS_STALE_MS")
        if an and not an.get("pageviews"):
            add("site-deployments", "warn", "近 7 天访问量是 0")
        ps = d.get("pagespeed") or {}
        stale("site-deployments", "PageSpeed", ps.get("fetchedAt"), "PAGESPEED_STALE_MS")
        snap["site-deployments"]["parts"] = {k: digest(d.get(k)) for k in ("production", "analytics", "pagespeed")}
        snap["site-deployments"]["pageviews"] = an.get("pageviews")
        snap["site-deployments"]["pagespeed"] = {k: (ps.get(k) or {}).get("score") for k in ("desktop", "mobile")}

    d = data.get("cloudflare-workers", {}).get("data")
    if d:
        stale("cloudflare-workers", "Worker 部署", d.get("deploymentsFetchedAt"), "CLOUDFLARE_DEPLOYMENTS_STALE_MS")
        stale("cloudflare-workers", "Worker 指标", d.get("fetchedAt"), "CLOUDFLARE_METRICS_STALE_MS")
        snap["cloudflare-workers"]["workers"] = sorted(w.get("name") for w in d.get("workers", []))
        snap["cloudflare-workers"]["parts"] = {f"{w.get('name')}.{k}": digest(w.get(k)) for w in d.get("workers", []) for k in ("metrics", "deployment")}
        for w in d.get("workers", []):
            missing = [k for k in ("metrics", "deployment") if not w.get(k)]
            if missing:
                add("cloudflare-workers", "warn", f"{w.get('name')} 缺 {', '.join(missing)}")

    d = data.get("health", {}).get("data")
    if d:
        for block, at in (d.get("blockAt") or {}).items():
            stale("health", f"{block} 块", at, "HEALTH_STALE_MS")
        for probe in ("uptime", "heartbeat"):
            p = d.get(probe) or {}
            if p.get("status") and p.get("status") != "up":
                rate = p.get("availability24h")
                rate_text = f"{rate:.1%}" if isinstance(rate, (int, float)) else "无数据"
                add("health", "alert", f"{probe} 状态 {p.get('status')}，24h 可用率 {rate_text}")
        snap["health"]["errors"] = d.get("errors")

    d = data.get("digest", {}).get("data")
    if d:
        stale("digest", "近况摘要", data["digest"].get("updatedAt"), "DIGEST_STALE_MS")
        if not d.get("quiet") and not d.get("headline"):
            add("digest", "alert", "摘要没有标题")
        snap["digest"]["model"] = d.get("model")

    d = data.get("listening", {}).get("data")
    if d:
        a = age(now, d.get("fetchedAt"))
        if a is None or a > 2 * HOUR:
            add("listening", "warn", f"最近在听已 {fmt(a)} 没拉到（apple-recent 闲时每 5 分钟拉一次）")

    history = state.get("snapshots") or {}
    findings += frozen_findings(history, snap, head_at, now)
    findings += drop_findings(history, snap)
    return {"now": now, "mainHead": head, "findings": findings, "snapshot": snap, "snapshots": next_snapshots(history, snap)}


def render_query(template, start, end):
    pattern = re.compile(r"const WINDOW = \{ from: null, to: null \};")
    if len(pattern.findall(template)) != 1:
        raise ValueError("errors-query.js 里找不到唯一一行 `const WINDOW = { from: null, to: null };`")
    return pattern.sub(f"const WINDOW = {{ from: {int(start)}, to: {int(end)} }};", template)


def query_window(state, now):
    start = state.get("lastRunAt")
    return (start if _number(start) else now - FIRST_WINDOW_MS), now


def _hashes(entry):
    sig = entry.get("signature")
    if isinstance(sig, str):
        return [sig]
    if isinstance(sig, list):
        return [s for s in sig if isinstance(s, str)]
    return []


def triage(result, ledger):
    by_hash, by_text = {}, {}
    for entry in ledger:
        hashes = _hashes(entry)
        for h in hashes:
            by_hash.setdefault(h, []).append(entry)
        if not hashes:
            for text in entry.get("signatures") or []:
                if isinstance(text, str):
                    by_text.setdefault(signature_hash(text), []).append(entry)
    new, known, muted, drift, backfill = [], [], [], [], []
    for sig in result.get("signatures") or []:
        h, text = sig.get("signature"), sig.get("text") or ""
        sample = sig.get("sample") or {}
        message = sample.get("message")
        if signature_hash(text) != h:
            drift.append({"signature": h, "text": text, "why": "哈希与文本对不上"})
        elif isinstance(message, str) and len(message.encode("utf-16-le")) // 2 < SAMPLE_CHARS and signature(sig.get("service"), message, sample.get("status")) != text:
            drift.append({"signature": h, "text": text, "why": f"check.py 归一化得到 {signature(sig.get('service'), message, sample.get('status'))!r}"})
        entries = by_hash.get(h, [])
        for e in by_text.get(h, []):
            backfill.append({"ledger": e.get("id"), "signature": h})
            entries = entries + [e]
        live = [e for e in entries if e.get("status") not in CLOSED]
        brief = {"signature": h, "text": text, "count": sig.get("count"), "firstSeen": sig.get("firstSeen"), "lastSeen": sig.get("lastSeen")}
        silenced = [e for e in live if e.get("status") == "muted"]
        if silenced:
            muted.append({**brief, "ledger": silenced[0].get("id")})
        elif live:
            known.append({**brief, "ledger": live[0].get("id"), "repro": live[0].get("repro"), "versions": sig.get("versions")})
        else:
            item = dict(sig)
            if entries:
                item["reopens"] = [e.get("id") for e in entries]
            new.append(item)
    filled = {b["ledger"] for b in backfill}
    unlinked = [
        {"id": e.get("id"), "status": e.get("status"), "signatures": e.get("signatures"), "msg": str(e.get("msg") or "")[:160]}
        for e in ledger
        if not _hashes(e) and e.get("status") not in CLOSED and e.get("id") not in filled and e.get("view") not in VIEWS
    ]
    return {
        "window": result.get("window"),
        "events": result.get("events"),
        "previews": result.get("previews"),
        "sampled": result.get("sampled"),
        "truncated": result.get("truncated"),
        "new": new,
        "known": known,
        "muted": muted,
        "backfill": backfill,
        "unlinked": unlinked,
        "drift": drift,
    }


def _shanghai(ms):
    return datetime.fromtimestamp(ms / 1000, timezone(timedelta(hours=8))).strftime("%Y-%m-%d %H:%M")


def main(argv):
    parser = argparse.ArgumentParser(description="collector 盯防：端点检查、渲染日志查询、按台账分拣签名")
    parser.add_argument("repo", nargs="?", default=".")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--query", action="store_true", help="打印填好本次窗口的 errors-query.js")
    mode.add_argument("--triage", metavar="RESULT_JSON", help="把 errors-query.js 的结果按台账分成新签名、已知未静音、已静音")
    args = parser.parse_args(argv)
    try:
        state = load_state(os.path.join(STATE_DIR, "state.json"))
    except StateError as e:
        print(e, file=sys.stderr)
        return 1
    if args.query:
        with open(QUERY_FILE, encoding="utf-8") as f:
            template = f.read()
        start, end = query_window(state, int(time.time() * 1000))
        print(render_query(template, start, end), end="")
        print(f"窗口 {_shanghai(start)} → {_shanghai(end)}（Asia/Shanghai）", file=sys.stderr)
        return 0
    if args.triage:
        with open(args.triage, encoding="utf-8") as f:
            result = json.load(f)
        out = triage(result, state.get("ledger") or [])
    else:
        out = check(args.repo, state)
    print(json.dumps(out, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
