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

// 只缓存选中的名字字符串：stub 和未决的 promise 都属于发起它的那个请求，跨请求复用会在后续请求里报 Connection error，
// 发起的请求先结束时还会一直挂着。有候选探测失败时退回北美只用于本次请求，下个请求再试日本。
const chosen = new WeakMap<EgressNamespace, string>();

async function pickEgress(namespace: EgressNamespace): Promise<{ name: string; settled: boolean }> {
  let settled = true;
  for (let i = 0; i < JAPAN_CANDIDATES; i++) {
    const name = `anthropic-jp-${i}`;
    try {
      if (JAPAN_COLOS.has(await namespace.get(namespace.idFromName(name), { locationHint: "apac" }).colo())) return { name, settled: true };
    } catch {
      settled = false;
    }
  }
  console.warn("[anthropic-egress] no Japan candidate, falling back to wnam");
  return { name: FALLBACK_NAME, settled };
}

async function egressName(namespace: EgressNamespace): Promise<string> {
  const cached = chosen.get(namespace);
  if (cached) return cached;
  const { name, settled } = await pickEgress(namespace);
  if (settled) chosen.set(namespace, name);
  return name;
}

export function anthropicFetch(env: Env): typeof fetch | undefined {
  const namespace = env.ANTHROPIC_EGRESS;
  if (!namespace) return undefined;
  let name: Promise<string> | undefined;
  return async (input, init) => {
    const picked = await (name ??= egressName(namespace));
    const stub = namespace.get(namespace.idFromName(picked), { locationHint: picked === FALLBACK_NAME ? "wnam" : "apac" });
    return stub.fetch(new Request(input, init));
  };
}
