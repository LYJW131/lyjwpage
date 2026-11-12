import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier !== "cloudflare:workers") return nextResolve(specifier, context);
  return { url: "data:text/javascript,export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env}}", shortCircuit: true };
} });
const { AlarmEgressProbe, handleAlarmEgressProbe } = await import("./alarm-egress-probe.ts");

test("task submission never calls the model; a fresh alarm instance runs once without persisting credentials", async (t) => {
  const values = new Map<string, unknown>();
  let scheduled = false;
  const storage = {
    get: async (key: string) => values.get(key),
    put: async (key: string | Record<string, unknown>, value?: unknown) => {
      if (typeof key === "string") values.set(key, value);
      else for (const [name, entry] of Object.entries(key)) values.set(name, entry);
    },
    setAlarm: async () => { scheduled = true; },
    transaction: async (fn: (value: unknown) => Promise<void>) => fn(storage),
  };
  let modelCalls = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init?: RequestInit) => {
    if (input.includes("cdn-cgi/trace")) return new Response("colo=SJC\n");
    modelCalls++;
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer probe-key");
    assert.equal(new Headers(init?.headers).has("cf-ipcountry"), false);
    return Response.json({ content: [{ type: "text", text: "OK" }], usage: { output_tokens: 1 } });
  });
  const state = { storage } as unknown as DurableObjectState;
  await new AlarmEgressProbe(state, { ALARM_PROBE_API_KEY: "probe-key" }).schedule();
  assert.equal(scheduled, true);
  assert.equal(modelCalls, 0);
  const consumer = new AlarmEgressProbe(state, { ALARM_PROBE_API_KEY: "probe-key" });
  await consumer.alarm();
  await consumer.alarm();
  assert.equal(modelCalls, 1);
  assert.equal(values.get("state"), "completed");
  assert.equal(JSON.stringify([...values]).includes("probe-key"), false);
});

test("unsigned public requests cannot reach a paid probe", async () => {
  const request = new Request("https://preview.example/api/preview/anthropic-alarm/sync?jobId=00000000-0000-0000-0000-000000000000", { method: "POST" });
  const response = await handleAlarmEgressProbe(request, {} as never);
  assert.equal(response.status, 403);
});
