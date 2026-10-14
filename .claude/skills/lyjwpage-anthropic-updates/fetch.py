#!/usr/bin/env python3
import hashlib
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime

STATE_DIR = os.environ.get("ANTHROPIC_UPDATES_DIR", "/mnt/project-files/anthropic-updates")
RELEASE_NOTES_URL = "https://platform.claude.com/docs/en/release-notes/overview"
CHANGELOG_URL = "https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md"
SDK_CHANGELOG_URL = "https://github.com/anthropics/anthropic-sdk-typescript/blob/main/CHANGELOG.md"
UA = "Mozilla/5.0 (lyjwpage anthropic-updates)"
# 新来源第一次扫描时只报这么久以内的条目，其余直接记为已见，免得把整个存档倒进摘要。
FIRST_LOOKBACK_S = 36 * 3600

# 用户 id 不随改名变；username 只用来拼链接。
X_ACCOUNTS = {
    "official": {
        "AnthropicAI": "1353836358901501952",
        "claudeai": "1943306828697550848",
        "ClaudeDevs": "2024518793679294464",
    },
    "anthropic": {
        "bcherny": "159337660",
        "_catwu": "974757274206978049",
        "trq212": "352806502",
        "alexalbert__": "1380719534970040322",
    },
    "builders": {
        "poteto": "2832427459",
        "mattpocockuk": "346640777",
        "karpathy": "33836629",
        "HamelHusain": "825766640",
    },
}

# 本站用到或可能用到的 Cloudflare 产品；changelog 其余分类（Zero Trust、WAN 等）不报。
CLOUDFLARE_PRODUCTS = {
    "Workers", "Durable Objects", "KV", "D1", "R2", "Workers AI", "Agents", "AI Gateway", "Cache",
    "Access", "Images", "Workflows", "Queues", "Containers", "Sandboxes", "Browser Run", "Logs",
    "Cloudflare Web Analytics", "Analytics", "Rules",
}


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        if r.status != 200:
            raise RuntimeError(f"HTTP {r.status} {url}")
        return r.read().decode("utf-8")


def epoch(text):
    if not text:
        return None
    try:
        return parsedate_to_datetime(text).timestamp()
    except (TypeError, ValueError):
        pass
    try:
        return time.mktime(time.strptime(text[:19], "%Y-%m-%dT%H:%M:%S")) - time.timezone
    except ValueError:
        try:
            return time.mktime(time.strptime(text[:10], "%Y-%m-%d")) - time.timezone
        except ValueError:
            return None


def sitemap(url):
    return re.findall(r"<loc>(.*?)</loc>(?:\s*<lastmod>(.*?)</lastmod>)?", get(url))


def from_sitemap(url, pattern, what):
    out = {u: {"date": m} for u, m in sitemap(url) if re.search(pattern, u)}
    if not out:
        raise RuntimeError(f"{url} 里没有{what}，页面结构可能变了")
    return out


def feed(url, what, keep=lambda item: True):
    root = ET.fromstring(get(url))
    atom = "{http://www.w3.org/2005/Atom}"
    out = {}
    for it in root.iter("item"):
        row = {
            "title": (it.findtext("title") or "").strip(),
            "date": it.findtext("pubDate") or "",
            "categories": [c.text for c in it.findall("category") if c.text],
        }
        link = (it.findtext("link") or it.findtext("guid") or "").strip()
        if link and keep(row):
            out[link] = row
    for it in root.iter(f"{atom}entry"):
        link_el = it.find(f"{atom}link[@rel='alternate']")
        if link_el is None:
            link_el = it.find(f"{atom}link")
        link = link_el.get("href") if link_el is not None else ""
        row = {"title": (it.findtext(f"{atom}title") or "").strip(), "date": it.findtext(f"{atom}published") or it.findtext(f"{atom}updated") or ""}
        if link and keep(row):
            out[link] = row
    if not out and what:
        raise RuntimeError(f"{url} 里没解析出{what}，页面结构可能变了")
    return out


def anthropic_posts():
    return from_sitemap("https://www.anthropic.com/sitemap.xml", r"anthropic\.com/(news|engineering)/[^/]+$", " news/engineering 链接")


def claude_dev_blog():
    return from_sitemap("https://claude.dev/sitemap.xml", r"claude\.dev/blog/[^/]+/?$", " blog 链接")


def claude_blog():
    return from_sitemap("https://claude.com/sitemap.xml", r"^https://claude\.com/resources/articles/[^/]+/?$", "文章链接")


def docs_pages():
    out = from_sitemap("https://platform.claude.com/sitemap.xml", r"platform\.claude\.com/docs/en/", "英文文档页")
    out.update(from_sitemap("https://code.claude.com/docs/sitemap.xml", r"code\.claude\.com/docs/en/", "英文文档页"))
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


def simonw():
    return feed("https://simonwillison.net/atom/entries/", "文章")


def latent_space():
    return feed("https://www.latent.space/feed", "文章")


def cloudflare():
    return feed(
        "https://developers.cloudflare.com/changelog/rss/index.xml",
        None,
        lambda row: bool(CLOUDFLARE_PRODUCTS & set(row["categories"])),
    )


def hacker_news():
    out = {}
    for query in ("claude", "anthropic"):
        q = urllib.parse.urlencode({"query": query, "tags": "story", "numericFilters": "points>150", "hitsPerPage": "50"})
        data = json.loads(get(f"https://hn.algolia.com/api/v1/search_by_date?{q}"))
        for h in data.get("hits", []):
            out[h["objectID"]] = {
                "title": h.get("title"),
                "url": h.get("url") or f"https://news.ycombinator.com/item?id={h['objectID']}",
                "hn": f"https://news.ycombinator.com/item?id={h['objectID']}",
                "points": h.get("points"),
                "date": h.get("created_at"),
            }
    return out


def changelog_versions(raw_url, heading):
    text = get(raw_url)
    versions, cur, body = [], None, []
    for line in text.splitlines():
        m = re.match(heading, line)
        if m:
            if cur:
                versions.append((cur, "\n".join(body).strip()))
            cur, body = m.group(1), []
        elif cur:
            body.append(line)
    if cur:
        versions.append((cur, "\n".join(body).strip()))
    if not versions:
        raise RuntimeError(f"{raw_url} 里没解析出版本号")
    return versions


VERSION_SOURCES = {
    "claude-code": ("https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md", r"^##\s+(\d+\.\d+\.\d+)\s*$", CHANGELOG_URL),
    "anthropic-sdk": ("https://raw.githubusercontent.com/anthropics/anthropic-sdk-typescript/main/CHANGELOG.md", r"^##\s+\[(\d+\.\d+\.\d+)\]", SDK_CHANGELOG_URL),
}


def x_timeline(user_id, since_id=None, start_time=None):
    tweets, token = [], None
    while True:
        q = {
            "exclude": "replies,retweets",
            "max_results": "100",
            "tweet.fields": "created_at,note_tweet,entities,article,referenced_tweets,public_metrics",
        }
        if since_id:
            q["since_id"] = since_id
        if start_time:
            q["start_time"] = start_time
        if token:
            q["pagination_token"] = token
        data = json.loads(get(f"https://api.x.com/2/users/{user_id}/tweets?" + urllib.parse.urlencode(q)))
        if "data" not in data and data.get("meta", {}).get("result_count") != 0:
            raise RuntimeError(json.dumps(data)[:300])
        tweets.extend(data.get("data", []))
        token = data.get("meta", {}).get("next_token")
        if not token:
            break
    tweets.sort(key=lambda t: int(t["id"]))
    return tweets


def x_newest(user_id):
    data = json.loads(get(f"https://api.x.com/2/users/{user_id}/tweets?max_results=5&exclude=replies,retweets"))
    return data.get("meta", {}).get("newest_id")


def x_scan(cursors, init):
    if isinstance(cursors, str):
        cursors = {"AnthropicAI": cursors}
    cursors = dict(cursors or {})
    new, errors, started = [], {}, []
    since = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - FIRST_LOOKBACK_S))
    for group, accounts in X_ACCOUNTS.items():
        for name, uid in accounts.items():
            try:
                if init:
                    newest = x_newest(uid)
                    if newest:
                        cursors[name] = newest
                    continue
                first = name not in cursors
                tweets = x_timeline(uid, start_time=since) if first else x_timeline(uid, since_id=cursors[name])
                if first:
                    started.append(name)
                    newest = tweets[-1]["id"] if tweets else x_newest(uid)
                    if newest:
                        cursors[name] = newest
                elif tweets:
                    cursors[name] = tweets[-1]["id"]
                for t in tweets:
                    urls = [u.get("expanded_url") for u in (t.get("note_tweet", {}).get("entities", {}) or t.get("entities", {})).get("urls", [])]
                    new.append({
                        "id": t["id"],
                        "group": group,
                        "account": name,
                        "createdAt": t["created_at"],
                        "url": f"https://x.com/{name}/status/{t['id']}",
                        "text": t.get("note_tweet", {}).get("text") or t.get("text"),
                        "article": (t.get("article") or {}).get("title"),
                        "likes": (t.get("public_metrics") or {}).get("like_count"),
                        "links": [u for u in urls if u],
                    })
            except Exception as e:
                errors[name] = str(e)[:200]
    return cursors, new, errors, started


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
    "claude-blog": claude_blog,
    "docs": docs_pages,
    "release-notes": release_notes,
    "simonw": simonw,
    "latent-space": latent_space,
    "cloudflare": cloudflare,
    "hn": hacker_news,
}


def recent(row):
    at = epoch(row.get("date") if isinstance(row, dict) else row)
    return at is not None and at > time.time() - FIRST_LOOKBACK_S


def scan(init=False):
    state = {"cursors": {}} if init else load_state()
    report, pending = {}, {"seen": {}, "cursors": {}}
    for name, fn in SET_SOURCES.items():
        try:
            cur = fn()
            first = init or not os.path.exists(seen_path(name))
            old = set() if first else read_seen(name)
            if first:
                new = [] if init else [{"key": k, **v} for k, v in cur.items() if recent(v)]
            else:
                new = [{"key": k, **v} for k, v in cur.items() if k not in old]
                if name == "docs" and len(cur) < 0.8 * len(old):
                    raise RuntimeError(f"文档页数从 {len(old)} 掉到 {len(cur)}，可能没抓全，不推进书签")
            pending["seen"][name] = sorted(old | set(cur))
            report[name] = {"ok": True, "total": len(cur), "new": new, **({"firstRun": True} if first else {})}
        except Exception as e:
            report[name] = {"ok": False, "error": str(e)[:300]}
    for name, (raw_url, heading, link) in VERSION_SOURCES.items():
        try:
            versions = changelog_versions(raw_url, heading)
            last = state["cursors"].get(name)
            names = [v for v, _ in versions]
            if init or last is None:
                new = []
            elif last not in names:
                raise RuntimeError(f"书签版本 {last} 不在 CHANGELOG 里，不猜，停下")
            else:
                new = [{"version": v, "notes": b, "url": link} for v, b in versions[: names.index(last)]]
            pending["cursors"][name] = names[0]
            report[name] = {"ok": True, "latest": names[0], "new": new, **({"firstRun": True} if last is None and not init else {})}
        except Exception as e:
            report[name] = {"ok": False, "error": str(e)[:300]}
    cursors, new, errors, started = x_scan(state["cursors"].get("x"), init)
    pending["cursors"]["x"] = cursors
    report["x"] = {"ok": not errors, "new": new, "failedAccounts": errors, "firstRunAccounts": started}
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
