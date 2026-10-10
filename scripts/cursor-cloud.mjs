export const DEFAULT_MODEL = "grok-4.7 reasoning_effort=xhigh fast=true";
export const TERMINAL_RUN_STATUSES = new Set(["FINISHED", "ERROR", "CANCELLED", "EXPIRED"]);

const CURSOR_API = "https://api.cursor.com";
const REQUEST_TIMEOUT_MS = 30_000;

// 写法：`<模型 id> <参数>=<值> …`，可用的 id 与参数以 GET /v1/models 为准。
export function parseModel(spec) {
  const [id, ...pairs] = String(spec ?? "").trim().split(/\s+/).filter(Boolean);
  if (!id) throw new Error("模型配置为空");
  const params = pairs.map((pair) => {
    const eq = pair.indexOf("=");
    if (eq <= 0 || eq === pair.length - 1) throw new Error(`模型参数应写成 key=value：${pair}`);
    return { id: pair.slice(0, eq), value: pair.slice(eq + 1) };
  });
  return params.length ? { id, params } : { id };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class HttpError extends Error {
  constructor(service, method, path, status, detail) {
    super(`${service} ${method} ${path} → ${status}${detail ? `: ${String(detail).slice(0, 300)}` : ""}`);
    this.status = status;
  }
}

export async function readError(response) {
  const text = await response.text().catch(() => "");
  const parsed = parseJson(text);
  return parsed?.message ?? parsed?.error?.message ?? text;
}

export function cursorClient({ apiKey, fetch = globalThis.fetch }) {
  async function request(method, path, body) {
    const response = await fetch(`${CURSOR_API}${path}`, {
      method,
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "user-agent": "lyjwpage-cursor" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new HttpError("Cursor", method, path, response.status, await readError(response));
    return response.json();
  }
  return {
    createAgent: (body) => request("POST", "/v1/agents", body),
    getRun: (agentId, runId) => request("GET", `/v1/agents/${agentId}/runs/${runId}`),
    cancelRun: (agentId, runId) => request("POST", `/v1/agents/${agentId}/runs/${runId}/cancel`, {}),
  };
}
