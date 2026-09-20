export function discordCreatedAt(id: string): string | null {
  if (!/^\d{17,20}$/.test(id)) return null;
  const timestamp = Number((BigInt(id) >> BigInt(22)) + BigInt(1420070400000));
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function discordConnectionUrl(connection: { type: string; id: string; name: string }): string | null {
  const { type, id, name } = connection;
  switch (type) {
    case "domain": return /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(name) ? `https://${name}` : null;
    case "github": return /^[a-z0-9-]+$/i.test(name) ? `https://github.com/${name}` : null;
    case "steam": return /^\d+$/.test(id) ? `https://steamcommunity.com/profiles/${id}` : null;
    case "twitter": return /^[a-z0-9_]+$/i.test(name) ? `https://x.com/${name}` : null;
    case "youtube": return /^[a-z0-9_-]+$/i.test(id) ? `https://www.youtube.com/channel/${id}` : null;
    default: return null;
  }
}
