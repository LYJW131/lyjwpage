export function discordGameUrl(applicationId: string | null): string | null {
  return applicationId && /^\d+$/.test(applicationId) ? `https://discord.com/games/${applicationId}` : null;
}
