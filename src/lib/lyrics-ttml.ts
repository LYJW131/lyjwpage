
export type LyricWord = {
  startMs: number;
  endMs: number;
  text: string;
};

export type LyricLine = {
  startMs: number;
  endMs: number;
  text: string;
  words?: LyricWord[];
};

export type LyricsTiming = "line" | "word" | "none";

export type ParsedLyrics = {
  timing: LyricsTiming;
  lines: LyricLine[];
  songwriters?: string[];
};

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
  word: { startMs: number; endMs: number; text: string } | null;
  hadWords: boolean;
};

function lineContent(inner: string): { text: string; words: LyricWord[] } {
  let out = "";
  const words: LyricWord[] = [];
  const open: OpenTag[] = [];
  let silenced = 0;

  const emit = (text: string) => {
    if (silenced) return;
    out += text;
    for (let i = open.length - 1; i >= 0; i -= 1) {
      const word = open[i].word;
      if (word) {
        word.text += text;
        return;
      }
    }
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

  for (const word of words) word.text = word.text.replace(/\s+/g, " ");
  if (words.length) {
    words[0].text = words[0].text.replace(/^\s+/, "");
    words[words.length - 1].text = words[words.length - 1].text.replace(/\s+$/, "");
  }
  return { text: out.replace(/\s+/g, " ").trim(), words };
}

function parseSongwriters(xml: string): string[] {
  const match = xml.match(/<songwriters>([\s\S]*?)<\/songwriters>/i);
  if (!match) return [];
  const writers: string[] = [];
  const re = /<songwriter[^>]*>([\s\S]*?)<\/songwriter>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(match[1])) !== null) {
    const name = decodeEntities(m[1]).trim();
    if (name && !writers.includes(name)) writers.push(name);
  }
  return writers;
}

export function parseLyricsTtml(ttml: string): ParsedLyrics {
  const timingRaw = ttml.match(/itunes:timing\s*=\s*"([^"]*)"/)?.[1]?.toLowerCase();
  const timing: LyricsTiming =
    timingRaw === "word" ? "word" : timingRaw === "line" ? "line" : "none";

  const songwriters = parseSongwriters(ttml);

  const bodyStart = ttml.search(/<body[\s>]/);
  const bodyEnd = ttml.lastIndexOf("</body>");
  if (timing === "none" || bodyStart < 0) {
    return { timing, lines: [], songwriters: songwriters.length ? songwriters : undefined };
  }
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
    if (timing === "word" && words.length) line.words = words;
    lines.push(line);
  }
  lines.sort((a, b) => a.startMs - b.startMs);
  return { timing, lines, songwriters: songwriters.length ? songwriters : undefined };
}
