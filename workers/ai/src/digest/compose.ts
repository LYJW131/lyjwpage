import type Anthropic from "@anthropic-ai/sdk";

import type { DigestHighlight, DigestOutcome, DigestTopic } from "@shared/digest";

import { digestFacts, readDigestViews } from "./facts";

export const DIGEST_MODEL = "claude-sonnet-5-5";
export const DIGEST_EFFORT = "low";
export const DIGEST_HEADLINE_MAX_CHARS = 48;
export const DIGEST_FIGURE_MAX_CHARS = 7;
export const DIGEST_CAPTION_MAX_CHARS = 48;

const TOPICS: Record<DigestTopic, string> = {
  coding: "time spent coding",
  agents: "AI coding agents and the models they ran",
  tokens: "tokens through the agents",
  site: "commits and deploys to this homepage",
  music: "listening",
  watching: "shows and films",
  gaming: "games played",
  trophies: "PlayStation trophies",
  fitness: "steps, workouts and Apple Watch rings",
};

export const DIGEST_SYSTEM_PROMPT = `You fill the summary card at the top of LYJW's personal homepage (lyjw.me). The page shows live data about LYJW: coding with AI agents, music, video, games, fitness, and work on this homepage itself. Once an hour you get a fact sheet about the past 24 hours; the card should tell a visitor at a glance what LYJW has been up to.

Return a headline and the 3 highlights that best sum up the day, most important first (2 if the day is quiet).
- headline: 3 to 6 words naming what dominated the day, sentence case, no final period. Refer to LYJW by name or not at all.
- Each highlight has a topic, a figure and a caption, and no two share a topic. Topics: ${Object.entries(TOPICS).map(([topic, meaning]) => `${topic} (${meaning})`).join("; ")}.
- figure: one number taken from the facts, rounded the way a person would, at most ${DIGEST_FIGURE_MAX_CHARS} characters with its unit or suffix: "22 h", "44M", "3,400", "10+", "$630". Keep a "+" when the facts have one.
- caption: a lowercase phrase of 2 to 6 words that reads after the figure and says what it counts, adding one detail where it fits: "coding, 16 h of it with agents", "tokens across four agents", "of music, mostly Hoshimachi Suisei".
Use only the facts given; don't guess at reasons, moods or plans, and don't say who did something unless the facts do. A light, dry touch is welcome in the headline; never mock.
Keep the names of songs, artists, shows and games exactly as written; don't translate or romanize them. Plain text in every field: no Markdown or emoji.`;

const DIGEST_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    highlights: {
      type: "array",
      items: {
        type: "object",
        properties: {
          topic: { type: "string", enum: Object.keys(TOPICS) },
          figure: { type: "string" },
          caption: { type: "string" },
        },
        required: ["topic", "figure", "caption"],
        additionalProperties: false,
      },
    },
  },
  required: ["headline", "highlights"],
  additionalProperties: false,
};

export type CreateMessage = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;

export async function digestInputHash(model: string, facts: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${DIGEST_SYSTEM_PROMPT}\n\0${JSON.stringify(DIGEST_SCHEMA)}\n\0${model}\n\0${facts}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const plain = (value: unknown) => (typeof value === "string" ? value.replace(/\*\*|`/g, "").replace(/\s+/g, " ").trim() : "");

// 结构化输出只保证形状；长度、主题去重和条数在这里把关，超长的一格丢掉也比整轮作废、首页停在一小时前强。
export function parseDigest(raw: string): { headline: string; highlights: DigestHighlight[] } | null {
  let parsed: { headline?: unknown; highlights?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const headline = plain(parsed.headline).replace(/[.。]$/, "");
  const seen = new Set<string>();
  const highlights = (Array.isArray(parsed.highlights) ? parsed.highlights : []).flatMap((item: { topic?: unknown; figure?: unknown; caption?: unknown }) => {
    const topic = item?.topic;
    const figure = plain(item?.figure);
    const caption = plain(item?.caption);
    if (typeof topic !== "string" || !(topic in TOPICS) || seen.has(topic)) return [];
    if (!figure || figure.length > DIGEST_FIGURE_MAX_CHARS || !caption || caption.length > DIGEST_CAPTION_MAX_CHARS) return [];
    seen.add(topic);
    return [{ topic: topic as DigestTopic, figure, caption }];
  }).slice(0, 3);
  if (!headline || headline.length > DIGEST_HEADLINE_MAX_CHARS || highlights.length < 2) return null;
  return { headline, highlights };
}

export async function composeDigest({
  readStatus,
  createMessage,
  previousInputHash,
  now,
  model = DIGEST_MODEL,
}: {
  readStatus: (path: string) => Promise<Response>;
  createMessage: CreateMessage;
  previousInputHash: string | null;
  now: number;
  model?: string;
}): Promise<DigestOutcome> {
  const facts = digestFacts(await readDigestViews(readStatus), now);
  const inputHash = await digestInputHash(model, facts);
  if (inputHash === previousInputHash) return { status: "unchanged" };
  const message = await createMessage({
    model,
    max_tokens: 2_048,
    output_config: { effort: DIGEST_EFFORT, format: { type: "json_schema", schema: DIGEST_SCHEMA } },
    system: DIGEST_SYSTEM_PROMPT,
    messages: [{ role: "user", content: facts }],
  });
  if (message.stop_reason !== "end_turn") throw new Error(`Digest model stopped with ${message.stop_reason}`);
  const digest = parseDigest(message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(""));
  if (!digest) throw new Error("Digest model returned no usable headline and highlights");
  return { status: "composed", digest: { ...digest, model: message.model, generatedAt: Date.now(), inputHash } };
}
