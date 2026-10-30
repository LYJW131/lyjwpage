async () => {
  // check.py --query 按这一行的原文把它换成本次窗口（epoch 毫秒）；不经它原样执行时取最近 24 小时。
  const WINDOW = { from: null, to: null };
  const WORKERS = ["core", "site", "ai", "ingress"];
  // 签名规则与 check.py#SIGNATURE_RULES 是同一份，signature-vectors.json 两边的测试都跑；改一边同改另一边。
  const SIGNATURE_CHARS = 120;
  const SIGNATURE_RULES = [
    [/[ \t\n\r\f\v]+/g, " "],
    [/([^ ?])\?[^ "'<>]+/g, "$1?<q>"],
    [/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, "<uuid>"],
    [/[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\.[0-9]+)?)?(?:Z|[+-][0-9]{2}:?[0-9]{2})?/g, "<time>"],
    [/(\.[cm]?js):[0-9]+:[0-9]+/g, "$1:<n>:<n>"],
    [/-[A-Za-z0-9_-]{8}\.js/g, "-<hash>.js"],
    [/[0-9A-Za-z]{16,}/g, (token) => ((token.match(/[0-9]/g) || []).length >= 4 ? "<id>" : token)],
    [/[0-9]{10,}/g, "<n>"],
  ];
  const PAGE = 2000;
  const MAX_PAGES = 10;
  // 一次查询的时间窗一长，Observability 就抽样（statistics.abr_level > 1），明细只回一部分：抽样了就对半拆开重查。
  const START_CHUNK_MS = 3 * 3_600_000;
  const MIN_CHUNK_MS = 15 * 60_000;
  const CONCURRENCY = 4;
  const SAMPLE_CHARS = 4000;
  // site 记 [browser-error] 时 Observability 只留调用栈（压缩后的函数名每次发布都变），错误类型与消息在同一请求的 Workers Issues 事件里，签名改用它。
  const BROWSER_ERROR = "[browser-error]";
  const ISSUES_DATASET = "real-time-issues";

  const to = WINDOW.to ?? Date.now();
  const from = WINDOW.from ?? to - 24 * 3_600_000;

  const signatureText = (service, message, status) => {
    let text = typeof status === "number" ? `${message} ${status}` : message;
    for (const [pattern, replacement] of SIGNATURE_RULES) text = text.replace(pattern, replacement);
    return `${service}: ${Array.from(text.replace(/^ +| +$/g, "")).slice(0, SIGNATURE_CHARS).join("")}`;
  };

  const signatureHash = async (text) => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 12);
  };

  const query = (t0, t1, offset) => cloudflare.request({
    method: "POST",
    path: `/accounts/${accountId}/workers/observability/telemetry/query`,
    body: {
      queryId: "lyjwpage-superfan-errors",
      timeframe: { from: t0, to: t1 },
      view: "events",
      dry: true,
      limit: PAGE,
      ...(offset ? { offset, offsetDirection: "next" } : {}),
      parameters: {
        datasets: ["cloudflare-workers", ISSUES_DATASET],
        filters: [
          { key: "$metadata.level", operation: "eq", type: "string", value: "error" },
          { key: "$workers.scriptName", operation: "in", type: "string", value: WORKERS.join(",") },
        ],
      },
    },
  });

  let queries = 0;
  let sampled = false;
  let truncated = false;

  const readChunk = async ([t0, t1]) => {
    const events = [];
    let offset;
    for (let page = 0; page < MAX_PAGES; page++) {
      queries++;
      const response = await query(t0, t1, offset);
      // 空窗口也回 events.events: []；缺了就是没查成，当成零条会让水位越过这段。
      if (!response.success || !Array.isArray(response.result?.events?.events)) {
        throw new Error(`遥测查询 ${new Date(t0).toISOString()}–${new Date(t1).toISOString()} 没查成：${JSON.stringify(response.errors ?? null)}`);
      }
      if ((response.result?.statistics?.abr_level ?? 1) > 1) {
        if (t1 - t0 > MIN_CHUNK_MS) return { split: true };
        sampled = true;
      }
      const got = response.result?.events?.events ?? [];
      events.push(...got);
      if (got.length < PAGE) return { events };
      offset = got[got.length - 1].$metadata.id;
    }
    truncated = true;
    return { events };
  };

  const seen = new Set();
  const groups = new Map();
  const previews = {};
  const issues = new Map();
  let counted = 0;

  const add = (event) => {
    const meta = event.$metadata ?? {};
    if (meta.id) {
      if (seen.has(meta.id)) return;
      seen.add(meta.id);
    }
    const workers = event.$workers ?? {};
    const service = workers.scriptName ?? meta.service ?? "unknown";
    // 分支预览与生产同名：预览的事件带 $workers.preview，归开分支的线程管，这里只计数。
    if (workers.preview?.slug || workers.preview?.id) {
      previews[service] = (previews[service] ?? 0) + 1;
      return;
    }
    const source = event.source;
    const log = String(meta.error || meta.message || (typeof source === "string" ? source : source?.message) || JSON.stringify(source ?? null));
    const issue = log.startsWith(BROWSER_ERROR) && meta.requestId ? issues.get(meta.requestId) : undefined;
    const message = issue ? `${BROWSER_ERROR} ${issue}` : log;
    const status = workers.event?.response?.status;
    const at = event.timestamp ?? Number(meta.timestampNs ?? 0) / 1e6;
    const text = signatureText(service, message, status);
    let group = groups.get(text);
    if (!group) {
      group = { text, service, count: 0, firstSeen: at, lastSeen: at, versions: new Set(), triggers: new Set(), sample: null };
      groups.set(text, group);
    }
    counted++;
    group.count++;
    group.firstSeen = Math.min(group.firstSeen, at);
    if (workers.scriptVersion?.id) group.versions.add(workers.scriptVersion.id);
    if (meta.trigger) group.triggers.add(meta.trigger);
    if (!group.sample || at >= group.lastSeen) {
      group.sample = {
        at,
        message: message.slice(0, SAMPLE_CHARS),
        log: log.slice(0, SAMPLE_CHARS),
        status: typeof status === "number" ? status : null,
        trigger: meta.trigger ?? null,
        requestId: meta.requestId ?? null,
        scriptVersion: workers.scriptVersion?.id ?? null,
      };
    }
    group.lastSeen = Math.max(group.lastSeen, at);
  };

  const read = [];
  let chunks = [];
  for (let t = from; t < to; t += START_CHUNK_MS) chunks.push([t, Math.min(t + START_CHUNK_MS, to)]);
  while (chunks.length) {
    const next = [];
    for (let i = 0; i < chunks.length; i += CONCURRENCY) {
      const batch = chunks.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(readChunk));
      results.forEach((result, j) => {
        if (result.split) {
          const [t0, t1] = batch[j];
          const mid = Math.floor((t0 + t1) / 2);
          next.push([t0, mid], [mid, t1]);
        } else {
          read.push(...result.events);
        }
      });
    }
    chunks = next;
  }
  // Issues 事件只给配对用，不单独计数。
  for (const event of read) {
    const meta = event.$metadata ?? {};
    if (event.dataset === ISSUES_DATASET && meta.requestId) issues.set(meta.requestId, String(meta.error || meta.message || ""));
  }
  read.filter((event) => event.dataset !== ISSUES_DATASET).forEach(add);

  const signatures = await Promise.all([...groups.values()].map(async (group) => ({
    signature: await signatureHash(group.text),
    text: group.text,
    service: group.service,
    count: group.count,
    firstSeen: group.firstSeen,
    lastSeen: group.lastSeen,
    versions: [...group.versions],
    triggers: [...group.triggers].slice(0, 5),
    sample: group.sample,
  })));
  signatures.sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
  return { window: { from, to }, workers: WORKERS, events: counted, previews, queries, sampled, truncated, signatures };
}
