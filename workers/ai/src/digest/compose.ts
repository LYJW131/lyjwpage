import type Anthropic from "@anthropic-ai/sdk";

import type { DigestOutcome } from "@shared/digest";

import { digestFacts, readDigestViews } from "./facts";

export const DIGEST_MODEL = "claude-sonnet-5-5";
export const DIGEST_EFFORT = "low";
export const DIGEST_MAX_CHARS = 480;

export const DIGEST_SYSTEM_PROMPT = `You write the summary card at the top of LYJW's personal homepage (lyjw.me). The page shows live data about LYJW: coding with AI agents, music, video, games, fitness, and work on this homepage itself. Once an hour you get a fact sheet about the past 24 hours; tell a visitor at a glance what LYJW has been up to.

Write 2 or 3 sentences in English, under 55 words in total. Open with what dominated the day, then add one or two other highlights that stand out; leave out the routine and anything the facts don't mention. Refer to LYJW by name or as "they". A light, dry touch is welcome; never mock.
Use only the facts given; don't guess at reasons, moods or plans. Don't describe what is happening this very minute: the text stays up for an hour.
Round numbers the way a person would ("nearly eight hours", "about 40 million tokens").
Keep the names of songs, artists, shows and games exactly as written; don't translate or romanize them.
Plain text only: no Markdown, emoji, lists, headings or surrounding quotation marks.`;

export type CreateMessage = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;

export async function digestInputHash(model: string, facts: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${DIGEST_SYSTEM_PROMPT}\n\0${model}\n\0${facts}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// 超长时在句末截断，丢掉末句也比整轮作废、首页停在一小时前强。
export function cleanDigestText(raw: string): string {
  let text = raw.replace(/\*\*|`/g, "").replace(/\s+/g, " ").trim();
  const quoted = /^["“](.*)["”]$/.exec(text);
  if (quoted) text = quoted[1].trim();
  if (text.length <= DIGEST_MAX_CHARS) return text;
  const sentences = text.match(/[^.!?。！？]+[.!?。！？]+["”’)]?\s*/g) ?? [];
  let kept = "";
  for (const sentence of sentences) {
    if ((kept + sentence).trim().length > DIGEST_MAX_CHARS) break;
    kept += sentence;
  }
  return kept.trim();
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
    output_config: { effort: DIGEST_EFFORT },
    system: DIGEST_SYSTEM_PROMPT,
    messages: [{ role: "user", content: facts }],
  });
  if (message.stop_reason !== "end_turn") throw new Error(`Digest model stopped with ${message.stop_reason}`);
  const text = cleanDigestText(message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(" "));
  if (!text) throw new Error("Digest model returned no usable text");
  return { status: "composed", digest: { text, model: message.model, generatedAt: Date.now(), inputHash } };
}
