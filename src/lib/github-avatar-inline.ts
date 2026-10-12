import { site as profile } from "@shared/site";
import type { SiteServices } from "@/server/site-context";

const AVATAR_PX = 128;
const AVATAR_QUALITY = 80;
const SOURCE_URL = `https://avatars.githubusercontent.com/u/${profile.githubId}?s=${AVATAR_PX * 2}`;

export function githubAvatarDataUri(site: SiteServices): Promise<string | null> {
  return site.image(SOURCE_URL, AVATAR_PX, "cover", AVATAR_QUALITY);
}
