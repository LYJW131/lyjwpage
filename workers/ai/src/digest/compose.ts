import type Anthropic from "@anthropic-ai/sdk";

import type { DigestHighlight, DigestOutcome, DigestTopic } from "@shared/digest";

import { digestMessage, readDigestViews } from "./facts";

export const DIGEST_MODEL = "claude-sonnet-5-5";
export const DIGEST_EFFORT = "low";
export const DIGEST_HEADLINE_MAX_CHARS = 48;
export const DIGEST_MAX_HIGHLIGHTS = 3;

const TOPICS: Record<DigestTopic, true> = {
  coding: true,
  agents: true,
  tokens: true,
  site: true,
  music: true,
  watching: true,
  gaming: true,
  trophies: true,
  fitness: true,
};

export const DIGEST_SYSTEM_PROMPT = `You fill the summary card at the top of LYJW's personal homepage (lyjw.me). The page shows live data about LYJW: coding with AI agents, music, video, games, fitness, and work on this homepage itself. Once an hour you get a fact sheet about the past 24 hours, ending with the highlight options the card can show; the card should tell a visitor at a glance what LYJW has been up to.

Return a headline and pick the highlights, unless the day is too quiet for a card.
- quiet: true when the past 24 hours had too little going on to be worth a card, such as only a few minutes of one or two things; the card then shows a plain clock, so return an empty headline and no picks. A day with even one substantial activity is not quiet.
- headline: 2 to 5 words naming what dominated the day, sentence case, no final period. Refer to LYJW by name or not at all.
- picks: the topics of the ${DIGEST_MAX_HIGHLIGHTS} highlight options that back up the headline, most important first; 2 if the day is light. Keep them in the same broad direction as the headline so the card tells one story: coding, agents, tokens and site go together, music, watching, gaming and trophies go together, fitness stands on its own. Reach outside that direction only when it has too few options. Pick only topics listed under "Highlight options"; the card shows each picked option's number and label exactly as listed there.
Use only the facts given; don't guess at reasons, moods or plans, and don't say who did something unless the facts do. A light, dry touch is welcome in the headline; never mock.
Keep the names of songs, artists, shows and games exactly as written; don't translate or romanize them. Plain text in the headline: no Markdown or emoji.`;

const DIGEST_SCHEMA = {
  type: "object",
  properties: {
    quiet: { type: "boolean" },
    headline: { type: "string" },
    picks: { type: "array", items: { type: "string", enum: Object.keys(TOPICS) } },
  },
  required: ["quiet", "headline", "picks"],
  additionalProperties: false,
};

export type CreateMessage = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;

export async function digestInputHash(model: string, facts: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${DIGEST_SYSTEM_PROMPT}\n\0${JSON.stringify(DIGEST_SCHEMA)}\n\0${model}\n\0${facts}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const plain = (value: unknown) => (typeof value === "string" ? value.replace(/\*\*|`/g, "").replace(/\s+/g, " ").trim() : "");

// 结构化输出只保证形状。quiet 一律发零格的空摘要；其余摘要的标题长度、选项外的主题、重复和条数在这里把关，可选格不足两条时有几条就要几条。
export function parseDigest(raw: string, options: DigestHighlight[]): { headline: string; highlights: DigestHighlight[]; quiet?: true } | null {
  let parsed: { quiet?: unknown; headline?: unknown; picks?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed.quiet === true) return { headline: "", highlights: [], quiet: true };
  const headline = plain(parsed.headline).replace(/[.。]$/, "");
  const picks = Array.isArray(parsed.picks) ? parsed.picks : [];
  const highlights = [...new Set(picks)]
    .flatMap((topic) => options.filter((option) => option.topic === topic))
    .slice(0, DIGEST_MAX_HIGHLIGHTS);
  const words = headline.split(" ").length;
  if (!headline || headline.length > DIGEST_HEADLINE_MAX_CHARS || words < 2 || words > 5 || highlights.length < Math.min(2, options.length)) return null;
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
  const { content, options } = digestMessage(await readDigestViews(readStatus), now);
  const inputHash = await digestInputHash(model, content);
  if (inputHash === previousInputHash) return { status: "unchanged" };
  const message = await createMessage({
    model,
    max_tokens: 2_048,
    output_config: { effort: DIGEST_EFFORT, format: { type: "json_schema", schema: DIGEST_SCHEMA } },
    system: DIGEST_SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  });
  if (message.stop_reason !== "end_turn") throw new Error(`Digest model stopped with ${message.stop_reason}`);
  const digest = parseDigest(message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(""), options);
  if (!digest) throw new Error("Digest model returned no usable headline and highlights");
  return { status: "composed", digest: { ...digest, model: message.model, generatedAt: Date.now(), inputHash } };
}
