import { githubAvatarPng, pngResponse } from "@/lib/github-avatar-icon";
import { site } from "@/lib/site";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";
export const alt = site.githubLogin;

export default async function AppleIcon() {
  return pngResponse(await githubAvatarPng(size.width), contentType);
}
