import { OnlineCounterRoom } from "./online-counter";
import { getCorsHeaders, isAllowedOrigin } from "../../api/src/origins";

export { OnlineCounterRoom };

export default {
  async fetch(request, env): Promise<Response> {
    const path = new URL(request.url).pathname;
    const headers = getCorsHeaders(request, env);
    headers.set("Cache-Control", "no-store");
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers });
    if (path === "/ws") {
      if (!isAllowedOrigin(request, env)) return new Response("Forbidden", { status: 403 });
      if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket upgrade", { status: 426 });
      return env.ONLINE_COUNTER.get(env.ONLINE_COUNTER.idFromName("global")).fetch(request);
    }
    if (path === "/count") {
      const online = await env.ONLINE_COUNTER.get(env.ONLINE_COUNTER.idFromName("global")).count();
      return Response.json({ ok: true, online }, { headers });
    }
    if (path === "/") return Response.json({ ok: true, service: "online-counter" }, { headers });
    return new Response("Not found", { status: 404, headers });
  },
} satisfies ExportedHandler<Env>;
