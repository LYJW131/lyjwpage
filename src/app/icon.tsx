import { githubAvatarPng } from "@/lib/github-avatar-icon";
import { site } from "@/lib/site";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";
export const alt = site.githubLogin;

export default async function Icon() {
  const png = await githubAvatarPng(size.width);
  return new Response(new Blob([png], { type: contentType }));
}
