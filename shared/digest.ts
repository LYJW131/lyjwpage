// 契约只加不改：采集 Worker 的 digest 任务经 Service Binding 调 ai 的 Digest 入口。ai 只能 import type：本文件不在 ai 的构建监视路径里。

export type DigestTopic = "coding" | "agents" | "tokens" | "site" | "music" | "watching" | "gaming" | "trophies" | "fitness";

export type DigestHighlight = {
  topic: DigestTopic;
  // 事实清单里取整后的数字，带单位或后缀，如 "22 h"、"44M"、"10+"。
  figure: string;
  // 接在数字后面读的一到三个英文小写词，像图例一样只说数字数的是什么，如 "coding"、"of music"。
  caption: string;
};

export type DigestPayload = {
  // 两到五个词、不带句号的英文短标题，点出这一天的主线。
  headline: string;
  // 按重要性排好的两到三件事，topic 互不重复。
  highlights: DigestHighlight[];
  model: string;
  // 模型写出这段文字的 epoch 毫秒；可滞后层条目的 updatedAt 是最近一次确认输入没变的时刻，二者可以相差好几个小时。
  generatedAt: number;
};

export type DigestRecord = DigestPayload & {
  // 模型输入（事实清单、提示词版本、模型）的哈希，下一轮据此判断输入有没有变。
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

export function publicDigest({ headline, highlights, model, generatedAt }: DigestPayload): DigestPayload {
  return { headline, highlights, model, generatedAt };
}
