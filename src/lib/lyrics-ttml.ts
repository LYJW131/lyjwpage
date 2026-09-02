/**
 * Apple Music 歌词 TTML → 按行的时间轴。纯函数，不碰网络、不碰 DOM。
 *
 * amp-api 的 `/lyrics` 给行级计时（`itunes:timing="Line"`），`/syllable-lyrics`
 * 给字级（`"Word"`，每个字一个带 begin/end 的 `<span>`）。两种的行都是 `<p begin
 * end>`，这里只取行 —— 卡片上只有一行的位置，字级的高亮没地方画，取回来也是
 * 白传（一首歌 16 KB 对 4.6 KB）。
 *
 * 服务端没有 DOMParser，自己走一遍标签。要认的东西很少：`<p>` 的 begin/end、
 * 里面的文字、`ttm:role="x-bg"` 的和声（丢掉，一行里混进括号里的和声只会更挤）。
 * `<head>` 一律不看 —— 那里的 `<translations>` 也是成段的文字，扫进去就成了行。
 */

export type LyricLine = {
  startMs: number;
  endMs: number;
  text: string;
};

export type LyricsTiming = "line" | "word" | "none";

export type ParsedLyrics = {
  timing: LyricsTiming;
  /** 按 startMs 升序。没有同步信息（timing=None、或 <p> 不带 begin）时为空 */
  lines: LyricLine[];
};

/**
 * TTML 的时钟表达式转毫秒。Apple 用的是 `ss.mmm` / `m:ss.mmm` / `h:mm:ss.mmm`
 * 三种，标准里还有 `12.5s` / `500ms` 这类带单位的写法，一并认。解不出返回 null。
 */
export function parseTtmlClock(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = raw.trim();
  const unit = value.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)$/);
  if (unit) {
    const amount = Number(unit[1]);
    const scale = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[unit[2] as "ms" | "s" | "m" | "h"];
    return Math.round(amount * scale);
  }
  const parts = value.split(":");
  if (parts.length > 3 || parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part))) return null;
  let ms = 0;
  for (const part of parts) ms = ms * 60 + Number(part) * 1_000;
  return Math.round(ms);
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1]?.toLowerCase() === "x" ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function attribute(attrs: string, name: string): string | undefined {
  const match = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`));
  return match?.[1];
}

/**
 * 一个 `<p>` 里的文字。`<span>` 可以套 `<span>`（和声那层里还有逐字的 span），
 * 所以要数深度：进了 x-bg 那层之后，直到它对应的闭合标签为止都不收文字。
 * `<br/>` 当空格；相邻 span 之间的空白文本节点保留（Apple 在字与字之间就是
 * 靠它分词的），最后统一折叠。
 */
function lineText(inner: string): string {
  let out = "";
  const open: boolean[] = [];
  let silenced = 0;
  const tokens = inner.matchAll(/<\/([a-zA-Z:]+)\s*>|<([a-zA-Z:]+)([^>]*?)(\/?)>|([^<]+)/g);
  for (const token of tokens) {
    const [, closing, opening, attrs, selfClosing, text] = token;
    if (text !== undefined) {
      if (!silenced) out += decodeEntities(text);
    } else if (closing) {
      if (open.pop()) silenced -= 1;
    } else if (opening) {
      if (selfClosing) {
        if (opening.toLowerCase() === "br") out += " ";
        continue;
      }
      const background = /(?:^|\s)ttm:role\s*=\s*"x-bg"/.test(attrs ?? "");
      open.push(background);
      if (background) silenced += 1;
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

export function parseLyricsTtml(ttml: string): ParsedLyrics {
  const timingRaw = ttml.match(/itunes:timing\s*=\s*"([^"]*)"/)?.[1]?.toLowerCase();
  const timing: LyricsTiming =
    timingRaw === "word" ? "word" : timingRaw === "line" ? "line" : "none";

  const bodyStart = ttml.search(/<body[\s>]/);
  const bodyEnd = ttml.lastIndexOf("</body>");
  if (timing === "none" || bodyStart < 0) return { timing, lines: [] };
  const body = ttml.slice(bodyStart, bodyEnd < 0 ? undefined : bodyEnd);

  const lines: LyricLine[] = [];
  for (const match of body.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)) {
    const [, attrs, inner] = match;
    const startMs = parseTtmlClock(attribute(attrs, "begin"));
    if (startMs == null) continue;
    const text = lineText(inner);
    if (!text) continue;
    const endMs = parseTtmlClock(attribute(attrs, "end"));
    lines.push({ startMs, endMs: Math.max(startMs, endMs ?? startMs), text });
  }
  lines.sort((a, b) => a.startMs - b.startMs);
  return { timing, lines };
}
