import { publicAssetPath } from "@/lib/asset-url";
import { site } from "@/lib/site";
import { BUILD_SCREENSHOT_LIMITS, PLAN_LABELS, planLanguage } from "@shared/build-routine";
import type { StoredRun } from "./coordinator";
import type { GithubBuildApi } from "./github";

export type ParsedScreenshot = { bytes: Uint8Array<ArrayBuffer>; ext: "png" | "jpg" | "webp"; contentType: string; caption: string };

export const SCREENSHOT_BODY_BYTES = Math.ceil(BUILD_SCREENSHOT_LIMITS.bytes / 3) * 4 + 4096;

function imageType(bytes: Uint8Array): Pick<ParsedScreenshot, "ext" | "contentType"> | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length > 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)) return { ext: "png", contentType: "image/png" };
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: "jpg", contentType: "image/jpeg" };
  if (bytes.length > 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { ext: "webp", contentType: "image/webp" };
  return null;
}

// 说明会进 PR 评论的 Markdown，只留字母、数字和少量标点，不给链接、自动链接、强调、HTML 和 @ 提及留口子。
function cleanCaption(value: string): string {
  return value.replace(/[^\p{L}\p{N} .,()×·—–-]/gu, " ").replace(/\s+/g, " ").trim();
}

export function parseScreenshot(value: unknown): ParsedScreenshot {
  const data = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!data || typeof data.caption !== "string" || typeof data.content !== "string") throw new Error("A caption and base64 image content are required.");
  const caption = cleanCaption(data.caption);
  if (!caption || caption.length > BUILD_SCREENSHOT_LIMITS.captionChars) throw new Error("Invalid screenshot caption.");
  if (data.content.length > Math.ceil(BUILD_SCREENSHOT_LIMITS.bytes / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data.content)) throw new Error("Invalid or oversized screenshot content.");
  const bytes = Uint8Array.from(atob(data.content), (char) => char.charCodeAt(0));
  const type = imageType(bytes);
  if (!type || bytes.length > BUILD_SCREENSHOT_LIMITS.bytes) throw new Error("Screenshots must be PNG, JPEG or WebP images within the size limit.");
  return { bytes, ...type, caption };
}

export async function screenshotObjectKey(shot: ParsedScreenshot): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", shot.bytes));
  return `${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}.${shot.ext}`;
}

export function screenshotComment(run: Pick<StoredRun, "plan" | "screenshots">): string | null {
  if (!run.screenshots?.length) return null;
  const labels = PLAN_LABELS[planLanguage(run.plan)];
  const images = run.screenshots.map(({ objectKey, caption }) => `**${caption}**\n\n![${caption}](${site.url}${publicAssetPath(objectKey)})`);
  return `## ${labels.screenshots}\n\n${labels.screenshotsNote}\n\n${images.join("\n\n")}`;
}

export async function postScreenshotComment(api: GithubBuildApi, prNumber: number, run: Pick<StoredRun, "plan" | "screenshots">): Promise<void> {
  const body = screenshotComment(run);
  if (body) await api.repo(`/issues/${prNumber}/comments`, "POST", { body });
}
