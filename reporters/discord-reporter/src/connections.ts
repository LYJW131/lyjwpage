import { readFile, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";

export type PublicConnection = { type: string; id: string; name: string };
type Token = { accessToken: string; refreshToken: string; expiresAt: number; userId: string };

export function publicConnections(input: unknown): PublicConnection[] {
  if (!Array.isArray(input)) throw new Error("Invalid Discord connections response");
  return input.filter((x) => x && x.visibility === 1 && !x.revoked &&
    typeof x.type === "string" && typeof x.id === "string" && typeof x.name === "string")
    .map(({ type, id, name }) => ({ type, id, name }));
}

export async function readConnections(dir: string, userId: string): Promise<PublicConnection[]> {
  const path = resolve(dir, "oauth-token.json");
  const token: Token = JSON.parse(await readFile(path, "utf8"));
  if (token.userId !== userId) throw new Error("OAuth account does not match DISCORD_USER_ID");
  if (Date.now() >= token.expiresAt - 300_000) {
    const client = JSON.parse(await readFile(resolve(dir, "oauth-client.json"), "utf8"));
    const response = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: client.clientId, client_secret: client.clientSecret, grant_type: "refresh_token", refresh_token: token.refreshToken }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Discord OAuth refresh failed (${response.status})`);
    const refreshed = await response.json() as { access_token: string; refresh_token: string; expires_in: number };
    if (!refreshed.access_token || !refreshed.refresh_token || !Number.isFinite(refreshed.expires_in)) throw new Error("Invalid OAuth refresh response");
    Object.assign(token, { accessToken: refreshed.access_token, refreshToken: refreshed.refresh_token, expiresAt: Date.now() + refreshed.expires_in * 1000 });
    await writeFile(path + ".tmp", JSON.stringify(token), { mode: 0o600 });
    await rename(path + ".tmp", path);
  }
  const response = await fetch("https://discord.com/api/v10/users/@me/connections", {
    headers: { Authorization: `Bearer ${token.accessToken}` }, signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Discord connections failed (${response.status})`);
  return publicConnections(await response.json());
}
