import { githubAvatarPng, pngResponse } from "@/lib/github-avatar-icon";

export async function GET() {
  return pngResponse(await githubAvatarPng(512), "image/png");
}
