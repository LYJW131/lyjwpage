const GITHUB_PAGES: [RegExp, (match: RegExpMatchArray) => string][] = [
  [/^\/[^/]+\/([^/]+)\/commit\/([0-9a-f]{7})/, (m) => `Commit ${m[2]} in the ${m[1]} repository on GitHub`],
  [/^\/[^/]+\/([^/]+)\/(?:tree|blob)\/[^/]+\/(?:.+\/)?([^/]+)\/?$/, (m) => `Source of ${m[2]} in the ${m[1]} repository on GitHub`],
  [/^\/[^/]+\/([^/]+)\/issues\/(\d+)/, (m) => `Issue #${m[2]} in the ${m[1]} repository on GitHub`],
  [/^\/[^/]+\/([^/]+)\/pull\/(\d+)/, (m) => `Pull request #${m[2]} in the ${m[1]} repository on GitHub`],
  [/^\/settings\b/, () => "Your GitHub settings"],
  [/^\/([^/]+)\/([^/]+)\/?$/, (m) => `The ${m[2]} repository on GitHub`],
  [/^\/([^/]+)\/?$/, (m) => `${decodeURIComponent(m[1])}'s profile on GitHub`],
];

const HOSTS: Record<string, string | ((url: URL) => string)> = {
  "claude.ai": "Claude usage settings",
  "cursor.com": "Cursor usage dashboard",
  "chatgpt.com": "Codex usage analytics on ChatGPT",
  "grok.com": "Grok",
  "dash.cloudflare.com": "Cloudflare dashboard (sign-in required)",
  "emby.lyjw131.com": "LYJW's Emby media server (sign-in required)",
  "music.apple.com": (url) => {
    const kind = url.pathname.split("/")[2];
    if (url.searchParams.has("i") || kind === "song") return "This song on Apple Music";
    if (kind === "album" || kind === "playlist" || kind === "artist") return `This ${kind} on Apple Music`;
    return "Apple Music";
  },
};

export function describeExternalLink(url: URL): string {
  const host = url.hostname.replace(/^www\./, "");
  if (host === "github.com") {
    for (const [pattern, describe] of GITHUB_PAGES) {
      const match = url.pathname.match(pattern);
      if (match) return describe(match);
    }
    return "GitHub";
  }
  const worker = host === "dash.cloudflare.com" && url.pathname.match(/\/workers\/services\/view\/([^/]+)/);
  if (worker) return `The ${worker[1]} Worker in the Cloudflare dashboard (sign-in required)`;
  const known = HOSTS[host];
  if (typeof known === "function") return known(url);
  if (known) return known;
  if (host.startsWith("status.")) return `Service status page on ${host}`;
  return `A page on ${host}`;
}
