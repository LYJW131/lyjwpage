export type MembershipResult = "present" | "absent" | "unknown";
export type MembershipCheck = (guildId: string) => Promise<MembershipResult>;

export function createMembershipCheck(
  settings: { token: string; targetUserId: string; timeoutMs: number },
  fetcher: typeof fetch = fetch,
): MembershipCheck {
  return async (guildId) => {
    try {
      const response = await fetcher(`https://discord.com/api/v10/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(settings.targetUserId)}`, {
        headers: { Authorization: `Bot ${settings.token}` },
        signal: AbortSignal.timeout(settings.timeoutMs),
        redirect: "error",
      });
      await response.body?.cancel();
      if (response.status === 200) return "present";
      if (response.status === 403 || response.status === 404) return "absent";
      return "unknown";
    } catch {
      return "unknown";
    }
  };
}
