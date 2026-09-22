import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Wrangler 4 lives beside the preview-wrangler package in pnpm's virtual store. */
export function previewWranglerBin() {
  const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const pkg = realpathSync(resolve(apiDir, "node_modules/preview-wrangler"));
  return resolve(pkg, "../wrangler/bin/wrangler.js");
}
