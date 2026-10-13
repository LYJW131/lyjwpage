// 契约只加不改：采集 Worker 的 digest 任务经 Service Binding 调 ai 的 Digest 入口。ai 只能 import type：本文件不在 ai 的构建监视路径里。

export type DigestTopic = "coding" | "agents" | "tokens" | "site" | "music" | "watching" | "gaming" | "trophies" | "fitness";

export type DigestUnit = "hours" | "minutes" | "count";

// 每一格由 ai 的代码从公开视图算出，模型只挑选哪几格，不写数字和说明。
export type DigestHighlight = {
  topic: DigestTopic;
  // 按 unit 写的裸数，取粗方式与事实清单相同；排版归站点。count 是完整的数（42M 写 42000000），hours 可带 .5。
  value: number;
  unit: DigestUnit;
  // 来源列表到了条数上限、窗口里可能还有没列出的：实际至少是 value。
  atLeast: boolean;
  // 接在数字后面的英文小写图例，如 "coding"、"music"、"agent time"。
  caption: string;
};

export type DigestPayload = {
  // 三到五个汉字、不带标点的中文短标题，点出这一天的主线。
  headline: string;
  // 模型按重要性挑出的两到三格，topic 互不重复；可选项不足两格时可以更少。
  highlights: DigestHighlight[];
  model: string;
  // 模型判断这 24 小时没什么值得写：headline 为空、highlights 为空，站点照旧显示时钟卡。
  quiet?: true;
  // 模型写出这段文字的 epoch 毫秒；可滞后层条目的 updatedAt 是最近一次确认输入没变的时刻，二者可以相差好几个小时。
  generatedAt: number;
};

export type DigestRecord = DigestPayload & {
  // 模型输入（事实清单与可选格、提示词版本、模型）的哈希，下一轮据此判断输入有没有变。
  inputHash: string;
};

export type DigestRequest = {
  previousInputHash: string | null;
};

// unconfigured：ai 没配模型密钥，采集方按缺配置跳过，不算故障。
export type DigestOutcome =
  | { status: "unchanged" }
  | { status: "unconfigured" }
  | { status: "composed"; digest: DigestRecord };

export interface DigestRpc {
  compose(request: DigestRequest): Promise<DigestOutcome>;
}

export function publicDigest({ headline, highlights, quiet, model, generatedAt }: DigestPayload): DigestPayload {
  return { headline, highlights, ...(quiet ? { quiet } : {}), model, generatedAt };
}
