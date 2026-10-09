import { GITHUB_APP_CLIENT_ID } from "@shared/github-issue";
import { readBoundedJson } from "./http";
export const GITHUB_API = "https://api.github.com";
export const GITHUB_API_HEADERS = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "lyjwpage-build" };

export async function exchangeCode(code: string, codeVerifier: string, secret: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  const response = await fetcher("https://github.com/login/oauth/access_token", {
    signal: AbortSignal.timeout(10_000),
    method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: GITHUB_APP_CLIENT_ID, client_secret: secret, code, code_verifier: codeVerifier }),
  }).catch(() => null);
  if (!response) return null;
  const data = await readBoundedJson(response, 16_384) as { access_token?: string } | null;
  return response.ok && typeof data?.access_token === "string" ? data.access_token : null;
}

export async function revoke(token: string, secret: string, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher(`${GITHUB_API}/applications/${GITHUB_APP_CLIENT_ID}/token`, {
    signal: AbortSignal.timeout(10_000), method: "DELETE", headers: { ...GITHUB_API_HEADERS, Authorization: `Basic ${btoa(`${GITHUB_APP_CLIENT_ID}:${secret}`)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ access_token: token }),
  }).catch(() => null);
  if (!response || response.status !== 204) console.warn("[build] GitHub token revocation failed", response?.status);
}
