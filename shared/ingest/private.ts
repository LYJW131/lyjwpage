import { object, text } from "@shared/json";

// 只写进 D1 的私有事实。和 prepareIngest 分开从原始请求体解析，交给 core 与 KV 的那份因此不会多出任何字段；
// 解析不出就是 null，不让整封上报失败。
export type PrivateFacts = { source: "homepod"; entityId: string };

const ENTITY_ID_MAX = 128;

export function preparePrivateFacts(source: string, raw: unknown): PrivateFacts | null {
  switch (source) {
    case "homepod": {
      const entityId = text(object(raw)?.entityId);
      return entityId ? { source, entityId: entityId.slice(0, ENTITY_ID_MAX) } : null;
    }
    default:
      return null;
  }
}
