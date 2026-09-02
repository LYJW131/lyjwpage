/**
 * Apple Music 歌词 TTML → 按行的时间轴。纯函数，不碰网络、不碰 DOM。
 *
 * amp-api 的 `/lyrics` 给行级计时（`itunes:timing="Line"`），`/syllable-lyrics`
 * 给字级（`"Word"`，每个字一个带 begin/end 的 `<span>`）。两种的行都是 `<p begin
 * end>`；字级那份的行还带 `words`，hero 上那一句按字从左到右点亮。
 *
 * 服务端没有 DOMParser，自己走一遍标签。要认的东西很少：`<p>` 的 begin/end、
 * 里面的文字、`ttm:role="x-bg"` 的和声（丢掉，一行里混进括号里的和声只会更挤）。
 * `<head>` 一律不看 —— 那里的 `<translations>` 也是成段的文字，扫进去就成了行。
 */

/** 逐字歌词里的一个字 / 词。`text` 带着它后面的空格，所有 words 的 text 拼起来就是整句 */
export type LyricWord = {
  startMs: number;
  endMs: number;
  text: string;
};

export type LyricLine = {
  startMs: number;
  endMs: number;
  text: string;
  /**
   * 逐字计时，只在 `/syllable-lyrics`（timing=Word）那份里有；行级那份没有这个
   * 字段，前端整句一起亮。和声（x-bg）不在里面，和 text 一致。
   */
  words?: LyricWord[];
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

type OpenTag = {
  background: boolean;
  /** 带 begin 的 span：正在收它的文字 */
  word: { startMs: number; endMs: number; text: string } | null;
  /** 里面已经出过更细的字了，它自己就不算一个字 */
  hadWords: boolean;
};

/**
 * 一个 `<p>` 里的文字和逐字。`<span>` 可以套 `<span>`（和声那层里还有逐字的
 * span），所以要数深度：进了 x-bg 那层之后，直到它对应的闭合标签为止都不收文字。
 * `<br/>` 当空格；相邻 span 之间的空白文本节点保留（Apple 在字与字之间就是
 * 靠它分词的），最后统一折叠。
 *
 * 逐字：每个带 begin 的 span 是一个字，字与字之间的空白挂到前一个字后面，这样
 * words 的 text 拼起来正好是整句。套着更细的 span 的那层不算字。
 */
function lineContent(inner: string): { text: string; words: LyricWord[] } {
  let out = "";
  const words: LyricWord[] = [];
  const open: OpenTag[] = [];
  let silenced = 0;

  const emit = (text: string) => {
    if (silenced) return;
    out += text;
    // 最里层正在收字的那个 span
    for (let i = open.length - 1; i >= 0; i -= 1) {
      const word = open[i].word;
      if (word) {
        word.text += text;
        return;
      }
    }
    // 不在任何字里（字之间的空格）：挂到前一个字后面
    const last = words[words.length - 1];
    if (last) last.text += text;
  };

  const tokens = inner.matchAll(/<\/([a-zA-Z:]+)\s*>|<([a-zA-Z:]+)([^>]*?)(\/?)>|([^<]+)/g);
  for (const token of tokens) {
    const [, closing, opening, attrs, selfClosing, text] = token;
    if (text !== undefined) {
      emit(decodeEntities(text));
    } else if (closing) {
      const tag = open.pop();
      if (!tag) continue;
      if (tag.background) silenced -= 1;
      if (tag.word && !tag.hadWords && !silenced) {
        const word = { ...tag.word, text: tag.word.text.replace(/\s+/g, " ") };
        if (word.text.trim()) {
          words.push(word);
          for (const parent of open) parent.hadWords = true;
        }
      }
    } else if (opening) {
      if (selfClosing) {
        if (opening.toLowerCase() === "br") emit(" ");
        continue;
      }
      const background = /(?:^|\s)ttm:role\s*=\s*"x-bg"/.test(attrs ?? "");
      const startMs = parseTtmlClock(attribute(attrs ?? "", "begin"));
      const endMs = parseTtmlClock(attribute(attrs ?? "", "end"));
      open.push({
        background,
        word:
          startMs != null && !background && !silenced
            ? { startMs, endMs: Math.max(startMs, endMs ?? startMs), text: "" }
            : null,
        hadWords: false,
      });
      if (background) silenced += 1;
    }
  }

  // 字后面挂上去的空白（比如丢掉的和声两侧各一个空格）也要折叠；
  // 首尾的空白只在整句层面去掉：第一个字前面、最后一个字后面
  for (const word of words) word.text = word.text.replace(/\s+/g, " ");
  if (words.length) {
    words[0].text = words[0].text.replace(/^\s+/, "");
    words[words.length - 1].text = words[words.length - 1].text.replace(/\s+$/, "");
  }
  return { text: out.replace(/\s+/g, " ").trim(), words };
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
    const { text, words } = lineContent(inner);
    if (!text) continue;
    const endMs = parseTtmlClock(attribute(attrs, "end"));
    const line: LyricLine = { startMs, endMs: Math.max(startMs, endMs ?? startMs), text };
    // 字级那份才带 words；行级的 <p> 里没有带 begin 的 span，自然是空的
    if (timing === "word" && words.length) line.words = words;
    lines.push(line);
  }
  lines.sort((a, b) => a.startMs - b.startMs);
  return { timing, lines };
}
