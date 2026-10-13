// 契约只加不改：采集 Worker 的 digest 任务经 Service Binding 调 ai 的 Digest 入口。ai 只能 import type：本文件不在 ai 的构建监视路径里。

export type DigestPayload = {
  // 模型写的两三句英文近况；人名、歌名、剧名照数据原样。
  text: string;
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

export function publicDigest({ text, model, generatedAt }: DigestPayload): DigestPayload {
  return { text, model, generatedAt };
}
