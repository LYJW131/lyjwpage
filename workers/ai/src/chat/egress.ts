import { DurableObject } from "cloudflare:workers";

import type { Env } from "../runtime";

const ANTHROPIC_HOST = "api.anthropic.com";
// Anthropic 拒绝来自不支持地区（如香港）的请求，返回 403 "Request not allowed"；Worker 在离访客最近的机房执行，
// 亚洲访客的请求会被拒。出站改由固定在日本的对象发出。locationHint 只在首次创建时生效、没有日本档：
// "apac" 实测会随机落到 HKG / SIN / KIX，所以按名字依次试，取第一个真落在日本机房的；都不在日本就退回北美。
const JAPAN_COLOS = new Set(["NRT", "HND", "KIX", "ITM", "FUK", "OKA"]);
const JAPAN_CANDIDATES = 8;
const FALLBACK_NAME = "anthropic-wnam";
const COLO_KEY = "colo";

export class AnthropicEgress extends DurableObject<Env> {
  private coloLookup?: Promise<string>;

  colo(): Promise<string> {
    this.coloLookup ??= this.lookupColo().catch((error: unknown) => {
      this.coloLookup = undefined;
      throw error;
    });
    return this.coloLookup;
  }

  private async lookupColo(): Promise<string> {
    const stored = await this.ctx.storage.get<string>(COLO_KEY);
    if (stored) return stored;
    const trace = await (await fetch("https://www.cloudflare.com/cdn-cgi/trace")).text();
    const colo = /^colo=(\w+)$/m.exec(trace)?.[1];
    if (!colo) throw new Error("colo missing from trace");
    await this.ctx.storage.put(COLO_KEY, colo);
    return colo;
  }

  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).hostname !== ANTHROPIC_HOST) return new Response("Forbidden", { status: 403 });
    // 调用方取消（访客停止或断开）时 request.signal 会 abort（要 enable_request_signal）。响应体原样直通时，
    // 取消要拖十来秒才传到上游，期间模型照样生成计费；经带信号的管道转一手，abort 当场掐断对 Anthropic 的连接。
    const upstream = await fetch(request, { signal: request.signal });
    if (!upstream.body) return upstream;
    return new Response(upstream.body.pipeThrough(new TransformStream(), { signal: request.signal }), upstream);
  }
}

type EgressNamespace = DurableObjectNamespace<AnthropicEgress>;
type EgressStub = DurableObjectStub<AnthropicEgress>;

const chosen = new WeakMap<EgressNamespace, Promise<EgressStub>>();

async function pickEgress(namespace: EgressNamespace): Promise<EgressStub> {
  for (let i = 0; i < JAPAN_CANDIDATES; i++) {
    const stub = namespace.get(namespace.idFromName(`anthropic-jp-${i}`), { locationHint: "apac" });
    try {
      if (JAPAN_COLOS.has(await stub.colo())) return stub;
    } catch {
      continue;
    }
  }
  console.warn("[anthropic-egress] no Japan candidate, falling back to wnam");
  return namespace.get(namespace.idFromName(FALLBACK_NAME), { locationHint: "wnam" });
}

export function anthropicFetch(env: Env): typeof fetch | undefined {
  const namespace = env.ANTHROPIC_EGRESS;
  if (!namespace) return undefined;
  let pick = chosen.get(namespace);
  if (!pick) {
    pick = pickEgress(namespace);
    chosen.set(namespace, pick);
  }
  const egress = pick;
  return async (input, init) => (await egress).fetch(new Request(input, init));
}
