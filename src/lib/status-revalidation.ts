import { revalidateTag } from "next/cache";

export async function expireStatusTags(tags: readonly string[]): Promise<void> {
  for (const tag of new Set(tags)) revalidateTag(`page:${tag}`, "max");
}
