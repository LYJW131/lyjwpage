interface Env {
  WARMUP_ORIGINS: string;
  /** wrangler secret，不要写进 [vars] */
  TELEMETRY_INGEST_SECRET?: string;
}

type Step = {
  ok: boolean;
  status?: number;
  ms: number;
  error?: string;
};

type Hit = {
  origin: string;
  ok: boolean;
  invalidate?: Step;
  get?: Step;
  ms: number;
  error?: string;
};

const USER_AGENT = "lyjwpage-cache-warmup";
const REVALIDATE_PATH = "/api/cron/revalidate-home";
const FETCH_TIMEOUT_MS = 60_000;

function parseOrigins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function homepageUrl(origin: string): URL | null {
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return new URL("/", url);
  } catch {
    return null;
  }
}

/** 把正文读完丢掉，好让源站把这次渲染走完、把 `'use cache'` 写上。 */
async function discardBody(res: Response): Promise<void> {
  if (!res.body) return;
  await res.body.pipeTo(new WritableStream());
}

async function request(
  url: URL,
  init: RequestInit,
): Promise<Step> {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      ...init,
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cf: { cacheTtl: 0 },
    });
    await discardBody(res);
    return {
      ok: res.ok,
      status: res.status,
      ms: Date.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function authHeaders(secret: string | undefined): HeadersInit {
  return {
    "user-agent": USER_AGENT,
    ...(secret ? { authorization: `Bearer ${secret}` } : {}),
  };
}

/**
 * GET `/` 打不掉 Vercel 上已经 prerender 好的 STALE 壳。先立刻 expire
 * 首屏 tag，再 GET 回填。POST 挂了（401/404/5xx）仍打 GET，两边都写进结果。
 */
async function hit(origin: string, secret: string | undefined): Promise<Hit> {
  const started = Date.now();
  const home = homepageUrl(origin);
  if (!home) {
    return { origin, ok: false, ms: 0, error: "invalid origin" };
  }

  const invalidate = await request(new URL(REVALIDATE_PATH, home), {
    method: "POST",
    headers: authHeaders(secret),
  });
  const get = await request(home, {
    method: "GET",
    headers: { "user-agent": USER_AGENT },
  });

  return {
    origin: home.origin,
    ok: invalidate.ok && get.ok,
    invalidate,
    get,
    ms: Date.now() - started,
  };
}

async function warmup(env: Env): Promise<Hit[]> {
  const secret = env.TELEMETRY_INGEST_SECRET?.trim() || undefined;
  return Promise.all(parseOrigins(env.WARMUP_ORIGINS).map((origin) => hit(origin, secret)));
}

export default {
  async scheduled(_controller, env) {
    const results = await warmup(env);
    console.log(JSON.stringify({ event: "warmup", results }));
  },

  async fetch(request, env) {
    if (request.method !== "GET") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    const results = await warmup(env);
    const ok = results.length > 0 && results.every((hit) => hit.ok);
    return Response.json({ ok, results }, { status: ok ? 200 : 502 });
  },
} satisfies ExportedHandler<Env>;
