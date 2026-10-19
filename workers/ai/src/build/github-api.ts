import { BUILD_REPO } from "@shared/build-routine";
import { GITHUB_APP_CLIENT_ID } from "@shared/github-issue";
import type { Env } from "../runtime";
import { readBoundedJson } from "./http";
import { base64url } from "./token";
import { GITHUB_API, GITHUB_API_HEADERS } from "./github-oauth";

function der(tag: number, bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const length: number[] = [];
  for (let n = bytes.length; n; n >>>= 8) length.unshift(n & 255);
  return Uint8Array.from([tag, ...(bytes.length < 128 ? [bytes.length] : [128 | length.length, ...length]), ...bytes]);
}

export async function githubAppJwt(privateKey: string, now = Date.now()): Promise<string> {
  const pem = privateKey.replaceAll("\\n", "\n");
  let bytes = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, "")), (char) => char.charCodeAt(0));
  if (pem.includes("BEGIN RSA PRIVATE KEY")) {
    bytes = der(0x30, Uint8Array.from([2, 1, 0, 0x30, 0x0d, 6, 9, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 1, 1, 1, 5, 0, ...der(4, bytes)]));
  }
  const key = await crypto.subtle.importKey("pkcs8", bytes, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const head = base64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const body = base64url(new TextEncoder().encode(JSON.stringify({ iss: GITHUB_APP_CLIENT_ID, iat: Math.floor(now / 1000) - 60, exp: Math.floor(now / 1000) + 540 })));
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${base64url(new Uint8Array(signature))}`;
}

export class GithubRequestError extends Error {
  status: number;
  constructor(status: number) { super(`GitHub request failed (${status}).`); this.status = status; }
}

export class GithubBuildApi {
  private token: string | undefined;
  private fetcher: typeof fetch;
  constructor(token: string | undefined, fetcher: typeof fetch = fetch) {
    this.token = token;
    // workerd 的全局 fetch 以别的对象作 this 调用会抛 Illegal invocation，存成方法前要包一层。
    this.fetcher = (input, init) => fetcher(input, init);
  }
  async request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const response = await this.fetcher(`${GITHUB_API}${path}`, {
      method, headers: { ...GITHUB_API_HEADERS, ...(this.token && { Authorization: `Bearer ${this.token}` }), ...(body !== undefined && { "Content-Type": "application/json" }) },
      ...(body !== undefined && { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new GithubRequestError(response.status);
    if (response.status === 204) return undefined as T;
    const data = await readBoundedJson(response, 8 * 1024 * 1024);
    if (data === null) throw new Error("GitHub returned an invalid or oversized response.");
    return data as T;
  }
  repo<T>(path: string, method = "GET", body?: unknown): Promise<T> { return this.request<T>(`/repos/${BUILD_REPO}${path}`, method, body); }
}

export async function installationApi(env: Env, fetcher: typeof fetch = fetch, readOnly = false): Promise<GithubBuildApi> {
  if (!env.GITHUB_APP_PRIVATE_KEY) throw new Error("GitHub builds are unavailable.");
  const app = new GithubBuildApi(await githubAppJwt(env.GITHUB_APP_PRIVATE_KEY), fetcher);
  const installation = await app.repo<{ id: number; permissions?: Record<string, string> }>("/installation");
  if (!Number.isSafeInteger(installation.id)) throw new Error("GitHub installation is unavailable.");
  const data = await app.request<{ token: string }>(`/app/installations/${installation.id}/access_tokens`, "POST", { repositories: [BUILD_REPO.split("/")[1]], permissions: { contents: readOnly ? "read" : "write", pull_requests: readOnly ? "read" : "write", issues: "read", ...(installation.permissions?.checks && { checks: "read" }), ...(installation.permissions?.statuses && { statuses: "read" }) } });
  if (typeof data.token !== "string") throw new Error("GitHub installation authorization failed.");
  return new GithubBuildApi(data.token, fetcher);
}

export async function currentMain(api: GithubBuildApi): Promise<string> {
  const data = await api.repo<{ object: { sha: string } }>("/git/ref/heads/main");
  if (!validSha(data.object?.sha)) throw new Error("GitHub main commit is unavailable.");
  return data.object.sha;
}

export function validSha(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{40}$/.test(value); }
