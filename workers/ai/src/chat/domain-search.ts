import type Anthropic from "@anthropic-ai/sdk";

import { object } from "@shared/json";

import { fetchJson, type WebPage } from "./web-search";

const RESULTS = 5;
const STEAM_DETAILS = 3;
const SUMMARY_CHARS = 600;
// Bangumi 要求带能认出调用方的 User-Agent，缺了会被拒。
const BANGUMI_USER_AGENT = "LYJW131/lyjwpage (https://github.com/LYJW131/lyjwpage)";
export const STORE_LANGUAGES = ["zh", "en"] as const;
type StoreLanguage = (typeof STORE_LANGUAGES)[number];
const STEAM_LOCALE: Record<StoreLanguage, { l: string; cc: string }> = { zh: { l: "schinese", cc: "cn" }, en: { l: "english", cc: "us" } };

// 两个领域工具都 defer_loading：模型先经 tool search 找到它们才加载定义，不占每条对话的上下文。
export const ANIME_SEARCH_TOOL: Anthropic.Beta.BetaTool = {
  name: "anime_search",
  description: "Look up anime on Bangumi (bgm.tv): Chinese and original titles, air date, episode count, community score and rank, tags and synopsis. Use it for questions about specific anime series or films.",
  input_schema: {
    type: "object",
    properties: { query: { type: "string", description: "The anime title in Chinese, Japanese or English." } },
    required: ["query"],
    additionalProperties: false,
  },
  strict: true,
  defer_loading: true,
};

export const GAME_SEARCH_TOOL: Anthropic.Beta.BetaTool = {
  name: "game_search",
  description: "Look up PC games on the Steam store: current price and discount, release date, genres, Metacritic score, platforms and a short description.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "The game title." },
      language: { type: "string", enum: [...STORE_LANGUAGES], description: "The visitor's language; zh shows the China store in CNY, en the US store in USD." },
    },
    required: ["query", "language"],
    additionalProperties: false,
  },
  strict: true,
  defer_loading: true,
};

export const DOMAIN_SEARCH_TOOLS = [ANIME_SEARCH_TOOL, GAME_SEARCH_TOOL];

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
const list = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.flatMap((item) => { const entry = object(item); return entry ? [entry] : []; }) : []);
const lines = (...items: (string | false | undefined)[]) => items.filter(Boolean).join("\n");

export async function animeSearch(query: string, signal: AbortSignal): Promise<WebPage[]> {
  const data = await fetchJson(`https://api.bgm.tv/v0/search/subjects?limit=${RESULTS}`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": BANGUMI_USER_AGENT },
    body: JSON.stringify({ keyword: query, filter: { type: [2] } }),
  }, signal);
  return list(data.data).flatMap((subject) => {
    if (typeof subject.id !== "number") return [];
    const name = text(subject.name);
    const title = text(subject.name_cn) ?? name;
    if (!title) return [];
    const rating = object(subject.rating);
    const score = typeof rating?.score === "number" && rating.score > 0 ? rating.score : undefined;
    const tags = list(subject.tags).flatMap((tag) => text(tag.name) ?? []).slice(0, 8);
    const date = text(subject.date);
    return [{
      url: `https://bgm.tv/subject/${subject.id}`,
      title: name && name !== title ? `${title} (${name})` : title,
      ...(date && { published: date }),
      text: lines(
        `Type: ${text(subject.platform) ?? "anime"}`,
        date && `Aired: ${date}`,
        typeof subject.eps === "number" && subject.eps > 0 && `Episodes: ${subject.eps}`,
        score !== undefined && `Bangumi score: ${score}/10 from ${rating?.total ?? "?"} votes${typeof rating?.rank === "number" && rating.rank > 0 ? `, rank #${rating.rank}` : ""}`,
        tags.length > 0 && `Tags: ${tags.join(", ")}`,
        text(subject.summary) && `Synopsis: ${text(subject.summary)!.replace(/\s+/g, " ").slice(0, SUMMARY_CHARS)}`,
      ),
    }];
  });
}

async function steamDetails(id: number, locale: { l: string; cc: string }, signal: AbortSignal): Promise<Record<string, unknown> | undefined> {
  try {
    const data = await fetchJson(`https://store.steampowered.com/api/appdetails?appids=${id}&l=${locale.l}&cc=${locale.cc}`, {}, signal);
    const entry = object(data[String(id)]);
    return entry?.success === true ? object(entry.data) ?? undefined : undefined;
  } catch {
    signal.throwIfAborted();
    return undefined;
  }
}

function steamPrice(item: Record<string, unknown>, details: Record<string, unknown> | undefined): string | undefined {
  if (details?.is_free === true) return "Free to play";
  const overview = object(details?.price_overview);
  if (overview && text(overview.final_formatted)) {
    const discount = typeof overview.discount_percent === "number" && overview.discount_percent > 0 ? ` (${overview.discount_percent}% off)` : "";
    return `${text(overview.final_formatted)}${discount}`;
  }
  const price = object(item.price);
  return price && typeof price.final === "number" && typeof price.currency === "string" ? `${(price.final / 100).toFixed(2)} ${price.currency}` : undefined;
}

export async function gameSearch(query: string, language: StoreLanguage, signal: AbortSignal): Promise<WebPage[]> {
  const locale = STEAM_LOCALE[language];
  const data = await fetchJson(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&l=${locale.l}&cc=${locale.cc}`, {}, signal);
  const items = list(data.items).filter((item) => typeof item.id === "number" && text(item.name)).slice(0, RESULTS);
  const details = await Promise.all(items.map((item, index) => (index < STEAM_DETAILS ? steamDetails(item.id as number, locale, signal) : undefined)));
  return items.map((item, index) => {
    const info = details[index];
    const release = object(info?.release_date);
    const date = release?.coming_soon === true ? "Coming soon" : text(release?.date);
    const metacritic = object(info?.metacritic);
    const genres = list(info?.genres).flatMap((genre) => text(genre.description) ?? []);
    const platforms = Object.entries(object(item.platforms) ?? {}).flatMap(([name, on]) => (on === true ? name : []));
    const price = steamPrice(item, info);
    return {
      url: `https://store.steampowered.com/app/${item.id}/`,
      title: text(info?.name) ?? text(item.name)!,
      text: lines(
        price && `Price: ${price}`,
        date && `Release date: ${date}`,
        genres.length > 0 && `Genres: ${genres.join(", ")}`,
        typeof metacritic?.score === "number" && `Metacritic: ${metacritic.score}`,
        platforms.length > 0 && `Platforms: ${platforms.join(", ")}`,
        text(info?.short_description) && `About: ${text(info?.short_description)!.slice(0, SUMMARY_CHARS)}`,
      ) || "Steam store page.",
    };
  });
}
