import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

import type { Env } from "./runtime.ts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier !== "cloudflare:workers") return nextResolve(specifier, context);
    return { url: "data:text/javascript,export class DurableObject{}", shortCircuit: true };
  },
});
const { anthropicFetch } = await import("./chat/egress.ts");

function namespace(colo: (name: string) => Promise<string>) {
  const probes: string[] = [];
  const used: string[] = [];
  const binding = {
    idFromName: (name: string) => name,
    get: (name: string) => ({
      colo: () => {
        probes.push(name);
        return colo(name);
      },
      fetch: async () => {
        used.push(name);
        return new Response("ok");
      },
    }),
  };
  const env = { ANTHROPIC_EGRESS: binding } as unknown as Env;
  return { env, probes, used };
}

test("探测出错时退回北美只用这一次，下个请求重新找日本对象", async () => {
  let failing = true;
  const { env, used } = namespace(async (name) => {
    if (failing && name === "anthropic-jp-0") throw new Error("reset");
    return name === "anthropic-jp-0" ? "KIX" : "HKG";
  });
  await anthropicFetch(env)!("https://api.anthropic.com/v1/messages");
  failing = false;
  await anthropicFetch(env)!("https://api.anthropic.com/v1/messages");
  assert.deepEqual(used, ["anthropic-wnam", "anthropic-jp-0"]);
});

test("选中的日本对象跨请求复用，不再探测", async () => {
  const { env, probes, used } = namespace(async (name) => (name === "anthropic-jp-1" ? "NRT" : "SIN"));
  const first = anthropicFetch(env)!;
  await first("https://api.anthropic.com/v1/messages");
  await first("https://api.anthropic.com/v1/messages");
  await anthropicFetch(env)!("https://api.anthropic.com/v1/messages");
  assert.deepEqual(probes, ["anthropic-jp-0", "anthropic-jp-1"]);
  assert.deepEqual(used, ["anthropic-jp-1", "anthropic-jp-1", "anthropic-jp-1"]);
});
