import { backendUrl } from "@/lib/backend-url";
import { homeBootstrap } from "@/lib/home-bootstrap";
import type { StatusResponse } from "@/lib/types";

/**
 * 浏览器侧取一份状态信封。打开页面后的第一次由 `/api/home` 聚合代答
 * （见 lib/home-bootstrap），其余照常直连该端点。
 */
export async function fetchStatus<T>(path: string): Promise<StatusResponse<T>> {
  const seeded = homeBootstrap.slice<T>(path);
  if (seeded) {
    const envelope = await seeded;
    if (envelope) return envelope;
  }
  const response = await fetch(backendUrl(path), { cache: "no-store" });
  if (!response.ok) throw new Error(`Request ${path} failed: ${response.status}`);
  return response.json();
}
