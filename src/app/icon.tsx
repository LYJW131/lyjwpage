import { githubAvatarPng, pngResponse } from "@/lib/github-avatar-icon";
import { site } from "@/lib/site";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";
export const alt = site.githubLogin;

export default async function Icon() {
  return pngResponse(await githubAvatarPng(size.width), contentType);
}
