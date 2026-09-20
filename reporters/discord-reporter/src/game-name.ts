const PLATFORM_SHELLS = new Set(["meta"]);

export function foldGameName(name: string): string {
  return name
    .replace(/[™®©]/g, "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();
}

/** Quest 连上来时 application_id 经常是 Meta 这个壳，不是游戏本身。 */
export function isPlatformShell(applicationName: string | null | undefined): boolean {
  if (!applicationName) return false;
  return PLATFORM_SHELLS.has(foldGameName(applicationName));
}

export function pickGameApplicationId(input: {
  name: string;
  applicationId: string | null;
  parentApplicationId: string | null;
  /** RPC 应用名。`undefined` 表示还没查到，保留原 applicationId。 */
  applicationName: string | null | undefined;
  detectableId: string | null;
}): string | null {
  if (input.parentApplicationId) return input.parentApplicationId;
  if (
    input.applicationId &&
    input.applicationName &&
    foldGameName(input.applicationName) === foldGameName(input.name)
  ) {
    return input.applicationId;
  }
  if (isPlatformShell(input.applicationName)) return input.detectableId;
  if (input.applicationId) return input.applicationId;
  return input.detectableId;
}
