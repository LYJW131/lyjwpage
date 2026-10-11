import type { GithubRecentCommit } from "@/lib/github-recent-commits";

export const SITE_ASSETS_PREFIX = "/site-assets";

export const SITE_ASSET_METADATA_PATH = `${SITE_ASSETS_PREFIX}/metadata.json`;

export type SiteAssetMetadata = {
  avatarDataUri: string | null;
  recentCommits: GithubRecentCommit[];
};

export function emptySiteAssetMetadata(): SiteAssetMetadata {
  return { avatarDataUri: null, recentCommits: [] };
}
