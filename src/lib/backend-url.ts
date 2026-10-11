import { workerUrl } from "@/lib/worker-url";

export function backendUrl(path: string): string {
  const url = workerUrl(process.env.PUBLIC_BACKEND_URL, path);
  if (!url) throw new Error("PUBLIC_BACKEND_URL is required");
  return url;
}
