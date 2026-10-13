#!/usr/bin/env python3
import hashlib
import json
import os
import re
import sys
import urllib.parse
import urllib.request

STATE_DIR = os.environ.get("ANTHROPIC_UPDATES_DIR", "/mnt/project-files/anthropic-updates")
X_USER_ID = "1353836358901501952"
RELEASE_NOTES_URL = "https://platform.claude.com/docs/en/release-notes/overview"
CHANGELOG_URL = "https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md"
UA = "Mozilla/5.0 (lyjwpage anthropic-updates)"


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        if r.status != 200:
            raise RuntimeError(f"HTTP {r.status} {url}")
        return r.read().decode("utf-8")


def sitemap(url):
    return re.findall(r"<loc>(.*?)</loc>(?:\s*<lastmod>(.*?)</lastmod>)?", get(url))


def anthropic_posts():
    rows = sitemap("https://www.anthropic.com/sitemap.xml")
    out = {u: m for u, m in rows if re.search(r"anthropic\.com/(news|engineering)/[^/]+$", u)}
    if not out:
        raise RuntimeError("sitemap 里没有 news/engineering 链接，页面结构可能变了")
    return out


def claude_dev_blog():
    rows = sitemap("https://claude.dev/sitemap.xml")
    out = {u: m for u, m in rows if re.search(r"claude\.dev/blog/[^/]+/?$", u)}
    if not out:
        raise RuntimeError("sitemap 里没有 blog 链接，页面结构可能变了")
    return out


def docs_pages():
    out = {}
    for sm, pat in (
        ("https://platform.claude.com/sitemap.xml", r"platform\.claude\.com/docs/en/"),
        ("https://code.claude.com/docs/sitemap.xml", r"code\.claude\.com/docs/en/"),
    ):
        hits = {u: m for u, m in sitemap(sm) if re.search(pat, u)}
        if not hits:
            raise RuntimeError(f"{sm} 里没有英文文档页，页面结构可能变了")
        out.update(hits)
    return out


def release_notes():
    text = get(RELEASE_NOTES_URL + ".md")
    items = {}
    date = None
    for line in text.splitlines():
        h = re.match(r"^###\s+(.+?)\s*$", line)
        if h:
            date = h.group(1)
            continue
        b = re.match(r"^\*\s+(.*)$", line)
        if b and date:
            key = hashlib.sha1(f"{date}|{b.group(1)[:100]}".encode()).hexdigest()[:16]
            items[key] = {"date": date, "text": b.group(1), "url": RELEASE_NOTES_URL}
    if not items:
        raise RuntimeError("release notes 里没解析出条目，页面结构可能变了")
    return items


def cc_versions():
    text = get("https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md")
    versions, cur, body = [], None, []
    for line in text.splitlines():
        m = re.match(r"^##\s+(\d+\.\d+\.\d+)\s*$", line)
        if m:
            if cur:
                versions.append((cur, "\n".join(body).strip()))
            cur, body = m.group(1), []
        elif cur:
            body.append(line)
    if cur:
        versions.append((cur, "\n".join(body).strip()))
    if not versions:
        raise RuntimeError("CHANGELOG 里没解析出版本号")
    return versions


def x_since(since_id):
    tweets, token = [], None
    while True:
        q = {
            "exclude": "replies,retweets",
            "max_results": "100",
            "tweet.fields": "created_at,note_tweet,entities,article,referenced_tweets",
            "since_id": since_id,
        }
        if token:
            q["pagination_token"] = token
        data = json.loads(get(f"https://api.x.com/2/users/{X_USER_ID}/tweets?" + urllib.parse.urlencode(q)))
        if "data" not in data and data.get("meta", {}).get("result_count") != 0:
            raise RuntimeError(json.dumps(data)[:300])
        tweets.extend(data.get("data", []))
        token = data.get("meta", {}).get("next_token")
        if not token:
            break
    tweets.sort(key=lambda t: int(t["id"]))
    out = []
    for t in tweets:
        urls = [u.get("expanded_url") for u in (t.get("note_tweet", {}).get("entities", {}) or t.get("entities", {})).get("urls", [])]
        out.append({
            "id": t["id"],
            "createdAt": t["created_at"],
            "url": f"https://x.com/AnthropicAI/status/{t['id']}",
            "text": t.get("note_tweet", {}).get("text") or t.get("text"),
            "article": (t.get("article") or {}).get("title"),
            "links": [u for u in urls if u],
        })
    return out


def seen_path(name):
    return os.path.join(STATE_DIR, "seen", f"{name}.txt")


def read_seen(name):
    with open(seen_path(name)) as f:
        return set(l.strip() for l in f if l.strip())


def load_state():
    with open(os.path.join(STATE_DIR, "state.json")) as f:
        return json.load(f)


SET_SOURCES = {
    "anthropic": anthropic_posts,
    "claude-dev": claude_dev_blog,
    "docs": docs_pages,
    "release-notes": release_notes,
}


def scan(init=False):
    state = {"cursors": {}} if init else load_state()
    report, pending = {}, {"seen": {}, "cursors": {}}
    for name, fn in SET_SOURCES.items():
        try:
            cur = fn()
            if init:
                new = []
            else:
                old = read_seen(name)
                new = [{"key": k, **(v if isinstance(v, dict) else {"lastmod": v})} for k, v in cur.items() if k not in old]
                if name == "docs" and len(cur) < 0.8 * len(old):
                    raise RuntimeError(f"文档页数从 {len(old)} 掉到 {len(cur)}，可能没抓全，不推进书签")
            pending["seen"][name] = sorted(set(cur) if init else old | set(cur))
            report[name] = {"ok": True, "total": len(cur), "new": new}
        except Exception as e:
            report[name] = {"ok": False, "error": str(e)[:300]}
    try:
        versions = cc_versions()
        last = state["cursors"].get("claude-code")
        names = [v for v, _ in versions]
        if init:
            new = []
        elif last not in names:
            raise RuntimeError(f"书签版本 {last} 不在 CHANGELOG 里，不猜，停下")
        else:
            new = [{"version": v, "notes": b, "url": CHANGELOG_URL} for v, b in versions[: names.index(last)]]
        pending["cursors"]["claude-code"] = names[0]
        report["claude-code"] = {"ok": True, "latest": names[0], "new": new}
    except Exception as e:
        report["claude-code"] = {"ok": False, "error": str(e)[:300]}
    try:
        if init:
            data = json.loads(get(f"https://api.x.com/2/users/{X_USER_ID}/tweets?max_results=5&exclude=replies,retweets"))
            newest = data["meta"]["newest_id"]
            new = []
        else:
            new = x_since(state["cursors"]["x"])
            newest = new[-1]["id"] if new else state["cursors"]["x"]
        pending["cursors"]["x"] = newest
        report["x"] = {"ok": True, "new": new}
    except Exception as e:
        report["x"] = {"ok": False, "error": str(e)[:300]}
    with open(os.path.join(STATE_DIR, "pending.json"), "w") as f:
        json.dump(pending, f)
    return report


def commit(only):
    with open(os.path.join(STATE_DIR, "pending.json")) as f:
        pending = json.load(f)
    path = os.path.join(STATE_DIR, "state.json")
    state = json.load(open(path)) if os.path.exists(path) else {"cursors": {}, "ledger": []}
    os.makedirs(os.path.join(STATE_DIR, "seen"), exist_ok=True)
    done = []
    for name, keys in pending["seen"].items():
        if only and name not in only:
            continue
        with open(seen_path(name), "w") as f:
            f.write("\n".join(keys) + "\n")
        done.append(name)
    for name, val in pending["cursors"].items():
        if only and name not in only:
            continue
        state["cursors"][name] = val
        done.append(name)
    state.setdefault("ledger", [])
    with open(path, "w") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)
    os.remove(os.path.join(STATE_DIR, "pending.json"))
    return done


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "scan"
    if cmd in ("scan", "init"):
        os.makedirs(STATE_DIR, exist_ok=True)
        print(json.dumps(scan(init=cmd == "init"), ensure_ascii=False, indent=1))
    elif cmd == "commit":
        print("advanced:", ", ".join(commit(set(sys.argv[2:]))))
    else:
        sys.exit("usage: fetch.py scan|init|commit [source ...]")
