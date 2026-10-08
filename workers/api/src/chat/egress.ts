import { DurableObject } from "cloudflare:workers";

import type { Env } from "../runtime";

const ANTHROPIC_HOST = "api.anthropic.com";
// Anthropic 拒绝来自不支持地区（如香港）的请求，返回 403 "Request not allowed"；Worker 在离访客最近的机房执行，
// 亚洲访客的请求会被拒。出站改由这个固定在北美的对象发出。locationHint 只在首次创建时生效，换区要换名字。
const EGRESS_NAME = "anthropic-wnam";
const EGRESS_HINT: DurableObjectLocationHint = "wnam";

export class AnthropicEgress extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).hostname !== ANTHROPIC_HOST) return new Response("Forbidden", { status: 403 });
    // 调用方取消（访客停止或断开）时 request.signal 会 abort（要 enable_request_signal）。响应体原样直通时，
    // 取消要拖十来秒才传到上游，期间模型照样生成计费；经带信号的管道转一手，abort 当场掐断对 Anthropic 的连接。
    const upstream = await fetch(request, { signal: request.signal });
    if (!upstream.body) return upstream;
    return new Response(upstream.body.pipeThrough(new TransformStream(), { signal: request.signal }), upstream);
  }
}

export function anthropicFetch(env: Env): typeof fetch | undefined {
  const namespace = env.ANTHROPIC_EGRESS;
  if (!namespace) return undefined;
  const stub = namespace.get(namespace.idFromName(EGRESS_NAME), { locationHint: EGRESS_HINT });
  return (input, init) => stub.fetch(new Request(input, init));
}
