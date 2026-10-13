import { workerUrl } from "@/lib/worker-url";
import { LIVE_SOCKET_PATH } from "@shared/live-heartbeat";

export function liveSocketUrl(): string | null {
  return workerUrl(process.env.PUBLIC_BACKEND_URL, LIVE_SOCKET_PATH, { websocket: true });
}
