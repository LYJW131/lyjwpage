import { GITHUB_APP_CLIENT_ID } from "@shared/github-issue";

export const GITHUB_API = "https://api.github.com";
export const GITHUB_API_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "lyjwpage-api",
};

export async function exchangeCode(code: string, codeVerifier: string, secret: string): Promise<string | null> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": GITHUB_API_HEADERS["User-Agent"] },
    body: JSON.stringify({ client_id: GITHUB_APP_CLIENT_ID, client_secret: secret, code, code_verifier: codeVerifier }),
  });
  const data = (await res.json().catch(() => null)) as { access_token?: string; error?: string } | null;
  if (!data?.access_token) console.warn("[github-oauth] code exchange failed", res.status, data?.error);
  return data?.access_token ?? null;
}

// 访客的 token 只用于当次请求，用完就撤销：Worker 不存它，也不留着备用。
export async function revoke(token: string, secret: string): Promise<void> {
  const res = await fetch(`${GITHUB_API}/applications/${GITHUB_APP_CLIENT_ID}/token`, {
    method: "DELETE",
    headers: { ...GITHUB_API_HEADERS, Authorization: `Basic ${btoa(`${GITHUB_APP_CLIENT_ID}:${secret}`)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ access_token: token }),
  }).catch(() => null);
  if (!res || res.status !== 204) console.warn("[github-oauth] token revoke failed", res?.status);
}
