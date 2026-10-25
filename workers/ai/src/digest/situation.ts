import type { DigestHighlight, DigestTopic } from "@shared/digest";

import type { DigestSignals } from "./facts";

// 每种情境一句中文说明：生成文案库的脚本把它交给模型，Clef 挑选时也随事实一起看到。改说明或增删情境后重跑 digest:taglines。
export const DIGEST_SITUATIONS = {
  agentsAllDay: "AI 编程代理几乎昼夜不停地在跑，写代码占满了整整一天",
  codingAllDay: "一整天大部分时间都在写代码，人一直坐在编辑器前",
  shipping: "给这个个人主页提交了很多次代码、上线了好几版",
  agentsLead: "主要是 AI 编程代理在干活，人在旁边指挥、审阅",
  handsOn: "亲手写了好几个小时代码，AI 代理只是帮手",
  codingLight: "写了一会儿代码，不算多，但是这一天的主线",
  musicLong: "音乐几乎放了一整天，一首接一首",
  music: "这一天以听歌为主",
  watchingBinge: "追番追了好几个小时，一集接一集",
  watching: "这一天主要在看番（日本动画番剧）",
  gamingLong: "打了好几个小时游戏",
  gaming: "这一天主要在玩游戏",
  trophyHunt: "打游戏拿了好几个 PlayStation 奖杯",
  workout: "这一天以运动为主，有一次像样的锻炼",
  walking: "这一天走了很多路",
  workAndPlay: "写代码和娱乐（看番或打游戏）各占一大块，张弛有度",
  soundtrack: "做别的事时音乐一直在放，当背景声",
  tokenFlood: "AI 代理消耗的 token 多到惊人，算力全开",
  workoutToo: "忙别的之余还抽空锻炼了一次",
  weekend: "今天是周末，周末也没闲着",
} as const;

export type DigestSituation = keyof typeof DIGEST_SITUATIONS;

type Family = "build" | "music" | "watching" | "gaming" | "fitness";

const FAMILY_TOPICS: Record<Family, DigestTopic[]> = {
  build: ["coding", "agents", "tokens", "site"],
  music: ["music"],
  watching: ["watching"],
  gaming: ["gaming", "trophies"],
  fitness: ["fitness"],
};

const PICK_ORDER: Partial<Record<DigestSituation, DigestTopic[]>> = {
  agentsAllDay: ["coding", "agents", "tokens", "site"],
  agentsLead: ["coding", "agents", "tokens", "site"],
  shipping: ["site", "coding", "agents", "tokens"],
  codingAllDay: ["coding", "site", "tokens", "agents"],
  handsOn: ["coding", "site", "tokens", "agents"],
  codingLight: ["coding", "site", "tokens", "agents"],
  musicLong: ["music", "watching", "gaming", "trophies"],
  music: ["music", "watching", "gaming", "trophies"],
  watchingBinge: ["watching", "music", "gaming", "trophies"],
  watching: ["watching", "music", "gaming", "trophies"],
  gamingLong: ["gaming", "trophies", "music", "watching"],
  gaming: ["gaming", "trophies", "music", "watching"],
  trophyHunt: ["trophies", "gaming", "music", "watching"],
  workout: ["fitness"],
  walking: ["fitness"],
};

export type DigestScene =
  | { quiet: true }
  | { quiet: false; primary: DigestSituation; accents: DigestSituation[]; highlights: DigestHighlight[] };

const hours = (option: DigestHighlight | undefined) => (!option ? 0 : option.unit === "hours" ? option.value : option.unit === "minutes" ? option.value / 60 : 0);

// coding 格是驾驶员时间（shared/pulse-types.ts#codingDriverSeconds），agents 格含两者同时的时段；代码一类按两者较大的计分，agent 自己跑的日子也算写代码的一天。
// 阈值是有意取的：音乐常当背景声放一整天，按半价计；看番、打游戏要人在场，按 1.5 倍计；锻炼一小时抵三小时。
// 安静的门槛对齐模型判 quiet 时的真实表现：15 分钟音乐加步数算安静，1.5 小时代码或 2.5 小时音乐不算。
export const QUIET_SCORE = 1;
// 提交和部署各只列最近几条（提交见 shared/github-repo.ts#RECENT_COMMIT_LIMIT，部署见 shared/site-deployments.ts#fetchSiteDeployments），活跃的日子几乎都满额，「频繁上线」分不出日子，只在代码少到不够判「代理主力」「亲手写」时做主线，其余做附带。
export const SHIPPING_COMMITS = 8;
export const SHIPPING_DEPLOYS = 4;
// 锻炼的计分权重高，一次长散步就能盖过一整天的代码；代码达到这个时长的日子，主线让给其余得分最高的一类，锻炼只做附带。
export const FITNESS_LEAD_MAX_BUILD_HOURS = 2;
// 别的一类得分到这里（约 4 小时音乐、1.3 小时看番或游戏），第三格让给它，不再用主线同一类的格子填满；音乐的门槛与附带情境 soundtrack 对齐。
export const GUEST_SCORE = 2;

// 卡片上的 site 格有提交数就只放提交数，部署数要从 signals 另看。
function shippingDay(options: DigestHighlight[], signals: DigestSignals): boolean {
  const site = options.find((option) => option.topic === "site");
  return (site?.caption === "commits" && site.value >= SHIPPING_COMMITS) || signals.deploys >= SHIPPING_DEPLOYS;
}

function familyScores(options: DigestHighlight[], signals: DigestSignals): Record<Family, number> {
  const find = (topic: DigestTopic) => options.find((option) => option.topic === topic);
  const count = (topic: DigestTopic) => (find(topic)?.unit === "count" ? find(topic)!.value : 0);
  return {
    build: Math.max(hours(find("coding")), hours(find("agents"))),
    music: hours(find("music")) * 0.5,
    watching: hours(find("watching")) * 1.5,
    gaming: hours(find("gaming")) * 1.5 + count("trophies") * 0.2,
    fitness: (signals.workoutMinutes / 60) * 3 + count("fitness") / 8_000,
  };
}

function primarySituation(family: Family, options: DigestHighlight[], scores: Record<Family, number>, signals: DigestSignals): DigestSituation {
  const find = (topic: DigestTopic) => options.find((option) => option.topic === topic);
  const driver = hours(find("coding"));
  const agents = hours(find("agents"));
  const counterpart = family === "build" ? Math.max(scores.watching, scores.gaming) : family === "watching" || family === "gaming" ? scores.build : 0;
  if (counterpart >= 2 && counterpart >= scores[family] * 0.6) return "workAndPlay";
  switch (family) {
    case "build":
      if (agents >= 16) return "agentsAllDay";
      if (driver >= 12 && agents < driver) return "codingAllDay";
      if (agents >= 3 && agents >= driver) return "agentsLead";
      if (driver >= 3) return "handsOn";
      if (shippingDay(options, signals)) return "shipping";
      return "codingLight";
    case "music":
      return hours(find("music")) >= 6 ? "musicLong" : "music";
    case "watching":
      return hours(find("watching")) >= 3 ? "watchingBinge" : "watching";
    case "gaming":
      if ((find("trophies")?.value ?? 0) >= 3) return "trophyHunt";
      return hours(find("gaming")) >= 4 ? "gamingLong" : "gaming";
    case "fitness":
      return signals.workoutMinutes >= 20 ? "workout" : "walking";
  }
}

function accentSituations(primary: DigestSituation, family: Family, options: DigestHighlight[], signals: DigestSignals): DigestSituation[] {
  const find = (topic: DigestTopic) => options.find((option) => option.topic === topic);
  const accents: DigestSituation[] = [];
  if (family !== "music" && hours(find("music")) >= 4) accents.push("soundtrack");
  if (primary !== "shipping" && family === "build" && shippingDay(options, signals)) accents.push("shipping");
  if ((find("tokens")?.value ?? 0) >= 1e9) accents.push("tokenFlood");
  if (family !== "fitness" && signals.workoutMinutes >= 20) accents.push("workoutToo");
  if (signals.weekend) accents.push("weekend");
  return accents;
}

function pickHighlights(primary: DigestSituation, family: Family, options: DigestHighlight[], scores: Record<Family, number>): DigestHighlight[] {
  const byScore = (Object.keys(scores) as Family[]).filter((other) => other !== family).sort((a, b) => scores[b] - scores[a]);
  const counterpart = family === "build" ? (scores.gaming > scores.watching ? "gaming" : "watching") : "build";
  const order: DigestTopic[] = primary === "workAndPlay"
    ? [FAMILY_TOPICS[family][0], FAMILY_TOPICS[counterpart][0], ...FAMILY_TOPICS[family].slice(1), ...FAMILY_TOPICS[counterpart].slice(1)]
    : PICK_ORDER[primary] ?? [];
  const available = (topics: DigestTopic[]) => topics.flatMap((topic) => options.filter((option) => option.topic === topic));
  const own = [...new Set(available(order))];
  if (primary !== "workAndPlay") {
    const head = own.slice(0, 2);
    const guest = byScore.filter((other) => scores[other] >= GUEST_SCORE).flatMap((other) => available(FAMILY_TOPICS[other]).slice(0, 1)).find((option) => !head.includes(option));
    if (guest) return [...head, guest];
  }
  const picked = own.slice(0, primary === "codingLight" ? 2 : 3);
  if (picked.length >= 2) return picked;
  const rest = available(byScore.flatMap((other) => FAMILY_TOPICS[other])).filter((option) => !picked.includes(option));
  return [...picked, ...rest].slice(0, 2);
}

export function digestScene(options: DigestHighlight[], signals: DigestSignals): DigestScene {
  const scores = familyScores(options, signals);
  const site = options.find((option) => option.topic === "site");
  const trophies = options.find((option) => option.topic === "trophies");
  const best = (entries: [Family, number][]) => entries.reduce((lead, entry) => (entry[1] > lead[1] ? entry : lead));
  const ranked = Object.entries(scores) as [Family, number][];
  const [leader, top] = best(ranked);
  const [family] = leader === "fitness" && scores.build >= FITNESS_LEAD_MAX_BUILD_HOURS ? best(ranked.filter(([name]) => name !== "fitness")) : [leader];
  if (top < QUIET_SCORE && signals.workoutMinutes < 20 && !trophies && Math.max(site?.value ?? 0, signals.deploys) < 3) return { quiet: true };
  const primary = primarySituation(family, options, scores, signals);
  return { quiet: false, primary, accents: accentSituations(primary, family, options, signals), highlights: pickHighlights(primary, family, options, scores) };
}
