import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID, sign } from "node:crypto";
import { parseArgs } from "node:util";
import { setTimeout } from "node:timers/promises";

let options;
try {
  options = parseArgs({ strict: true, options: {
    origin: { type: "string" }, key: { type: "string" }, out: { type: "string" }, runs: { type: "string", default: "10" },
  } }).values;
  if (!options.origin || !options.key || !options.out || !/^\d+$/.test(options.runs) || Number(options.runs) < 1 || Number(options.runs) > 20) throw new Error("arguments");
} catch {
  console.error("Usage: alarm-egress-benchmark.ts --origin URL --key PEM --out JSON [--runs 1..20]");
  process.exit(2);
}
const key = readFileSync(options.key);
const samples: Record<string, unknown>[] = [];

async function call(action: string, jobId: string) {
  const path = `/api/preview/anthropic-alarm/${action}`;
  const method = action === "result" ? "GET" : "POST";
  const signature = sign(null, Buffer.from(`${method}\n${path}\n${jobId}`), key).toString("base64");
  const response = await fetch(`${options.origin}${path}?jobId=${jobId}`, {
    method, headers: { "x-probe-signature": signature }, signal: AbortSignal.timeout(40_000),
  });
  if (!response.ok) throw new Error(`probe ${action}: HTTP ${response.status}; ${(await response.text()).slice(0, 120)}`);
  return await response.json() as { caller: unknown; state?: string; result?: Record<string, unknown> };
}

const readinessDeadline = Date.now() + 60_000;
for (;;) {
  try {
    await call("result", randomUUID());
    break;
  } catch (error) {
    if (Date.now() >= readinessDeadline) throw error;
    await setTimeout(1_000);
  }
}

for (let index = 0; index < Number(options.runs); index++) {
  const jobId = randomUUID();
  const order = index % 2 ? ["alarm", "sync"] : ["sync", "alarm"];
  const sample: Record<string, unknown> = { jobId, order };
  for (const mode of order) {
    if (mode === "sync") {
      const response = await call("sync", jobId);
      sample.caller = response.caller;
      sample.sync = response.result;
    } else {
      await call("start", jobId);
      let result;
      const deadline = Date.now() + 45_000;
      do {
        await setTimeout(100);
        result = await call("result", jobId);
      } while (result.state === "pending" || result.state === "running" ? Date.now() < deadline : false);
      if (result.state !== "completed") throw new Error(`alarm ${result.state}`);
      sample.alarm = result.result;
    }
  }
  samples.push(sample);
  writeFileSync(options.out, JSON.stringify({ recordedAt: new Date().toISOString(), samples }, null, 2));
  console.log(JSON.stringify(sample));
}
