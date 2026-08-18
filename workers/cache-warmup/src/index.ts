interface Env {
  WARMUP_ORIGINS: string;
}

type Hit = {
  origin: string;
  ok: boolean;
  status?: number;
  ms: number;
  error?: string;
};

const USER_AGENT = "lyjwpage-cache-warmup";
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

async function hit(origin: string): Promise<Hit> {
  const started = Date.now();
  const url = homepageUrl(origin);
  if (!url) {
    return { origin, ok: false, ms: 0, error: "invalid origin" };
  }

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cf: { cacheTtl: 0 },
    });
    await discardBody(res);
    return {
      origin: url.origin,
      ok: res.ok,
      status: res.status,
      ms: Date.now() - started,
    };
  } catch (error) {
    return {
      origin: url.origin,
      ok: false,
      ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function warmup(env: Env): Promise<Hit[]> {
  return Promise.all(parseOrigins(env.WARMUP_ORIGINS).map(hit));
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
