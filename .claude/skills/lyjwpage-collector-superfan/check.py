#!/usr/bin/env python3
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

STATE_DIR = os.environ.get("SUPERFAN_DIR", "/mnt/project-files/superfan-collector")
BASE = os.environ.get("SUPERFAN_BASE", "https://lyjw.me")
HOUR = 3_600_000

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


def check(repo):
    now = int(time.time() * 1000)
    th = thresholds(repo)
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
        snap[view] = {
            "hash": digest(body.get("data")),
            "updatedAt": body.get("updatedAt"),
        }

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
        head, head_at = main_head(repo)
        top = (d.get("recentCommits") or [{}])[0].get("oid")
        lag = age(now, head_at)
        if top != head and lag > 2 * HOUR:
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

    return {"now": now, "mainHead": main_head(repo)[0], "findings": findings, "snapshot": snap}


if __name__ == "__main__":
    repo = sys.argv[1] if len(sys.argv) > 1 else "."
    print(json.dumps(check(repo), ensure_ascii=False, indent=1))
