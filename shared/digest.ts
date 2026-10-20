// 契约只加不改：采集 Worker 的 digest 任务经 Service Binding 调 ai 的 Digest 入口。ai 只能 import type：本文件不在 ai 的构建监视路径里。

export type DigestTopic = "coding" | "agents" | "tokens" | "site" | "music" | "watching" | "gaming" | "trophies" | "fitness";

export type DigestUnit = "hours" | "minutes" | "count";

// 每一格由 ai 的代码从公开视图算出并按情境挑选，不写数字和说明。
export type DigestHighlight = {
  topic: DigestTopic;
  // 按 unit 写的裸数，取粗方式与事实清单相同；排版归站点。count 是完整的数（42M 写 42000000），hours 可带 .5。
  value: number;
  unit: DigestUnit;
  // 来源列表到了条数上限、窗口里可能还有没列出的：实际至少是 value。
  atLeast: boolean;
  // 接在数字后面的英文小写图例，如 "driver time"、"music"、"agent time"。
  caption: string;
};

export type DigestPayload = {
  // 三到五个汉字、不带标点的中文短标题，点出这一天的主线。
  headline: string;
  // 站点轮换显示的标题池，headline 在首位，条目与 headline 同格式、互不重复；旧记录没有这一项，只显示 headline。
  headlines?: string[];
  // 按情境规则挑出的两到三格，最重要的在前，topic 互不重复；可选项不足两格时可以更少。
  highlights: DigestHighlight[];
  // 谁定的标题：从文案库里挑中它的模型（如 "@cf/cloudflare/clef"），或按规则直接取用时为 "rules"。
  model: string;
  // 规则判断这 24 小时没什么值得写：headline 为空、highlights 为空，站点照旧显示时钟卡。
  quiet?: true;
  // 定下这份摘要的 epoch 毫秒；可滞后层条目的 updatedAt 是最近一次确认输入没变的时刻，二者可以相差好几个小时。
  generatedAt: number;
};

export type DigestRecord = DigestPayload & {
  // 输入（事实清单与可选格、情境说明、文案库、挑选说明）的哈希，下一轮据此判断输入有没有变。
  inputHash: string;
};

export type DigestRequest = {
  previousInputHash: string | null;
  // 上一份摘要的标题：还在这一轮的候选里就沿用，不重新挑。
  previousHeadline?: string | null;
};

// unconfigured：ai 缺必需的配置，采集方按缺配置跳过，不算故障。
export type DigestOutcome =
  | { status: "unchanged" }
  | { status: "unconfigured" }
  | { status: "composed"; digest: DigestRecord };

export interface DigestRpc {
  compose(request: DigestRequest): Promise<DigestOutcome>;
}

export function publicDigest({ headline, headlines, highlights, quiet, model, generatedAt }: DigestPayload): DigestPayload {
  return { headline, ...(headlines ? { headlines } : {}), highlights, ...(quiet ? { quiet } : {}), model, generatedAt };
}
