import { workerUrl } from "@/lib/worker-url";

export function liveSocketUrl(): string | null {
  return workerUrl(process.env.NEXT_PUBLIC_BACKEND_URL, "/ws", { websocket: true });
}
