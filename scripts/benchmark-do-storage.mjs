#!/usr/bin/env node
/** Compare SqliteStore query costs in an isolated local SQLite Durable Object. */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(join(root, "workers/api/package.json"));

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}
function positiveInteger(name, fallback) {
  const raw = option(name, String(fallback));
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}
const ref = option("--ref", "HEAD");
const rows = positiveInteger("--rows", 6000);
const rounds = positiveInteger("--rounds", 5);
const writeRounds = positiveInteger("--write-rounds", 100);
const temporary = await mkdtemp(join(tmpdir(), "lyjw-do-storage-benchmark-"));
const logs = [];
let child;

function atRef(path) {
  return execFileSync("git", ["show", `${ref}:${path}`], { cwd: root, encoding: "utf8" });
}
function localImport(source) {
  return source.replace('from "@shared/storage-contract"', 'from "./storage-contract"');
}
async function availablePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  await new Promise((resolveClose) => server.close(resolveClose));
  return address.port;
}
async function eventually(check) {
  const deadline = Date.now() + 45_000;
  let failure;
  do {
    try { return await check(); } catch (error) { failure = error; }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  } while (Date.now() < deadline);
  throw failure;
}

const workerSource = `
import { DurableObject } from "cloudflare:workers";
import { SqliteStore as BaseStore } from "./base/sqlite-store";
import { SqliteStore as WorktreeStore } from "./worktree/sqlite-store";

const stores = { base: BaseStore, worktree: WorktreeStore };
function measured(sql) {
  const metrics = { rowsRead: 0, rowsWritten: 0, statements: 0 };
  return {
    metrics,
    reset() { metrics.rowsRead = 0; metrics.rowsWritten = 0; metrics.statements = 0; },
    sql: {
      exec(query, ...bindings) {
        const cursor = sql.exec(query, ...bindings);
        const rows = cursor.toArray();
        metrics.rowsRead += cursor.rowsRead;
        metrics.rowsWritten += cursor.rowsWritten;
        metrics.statements += 1;
        return { toArray: () => rows, rowsWritten: cursor.rowsWritten };
      },
    },
  };
}
async function digest(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
export class StorageBenchmark extends DurableObject {
  async fetch(request) {
    if (request.method === "GET") return Response.json({ ok: true });
    const input = await request.json();
    const Store = stores[input.variant];
    if (!Store || !Number.isSafeInteger(input.rows) || !Number.isSafeInteger(input.rounds)) {
      return Response.json({ error: "invalid benchmark input" }, { status: 400 });
    }
    const raw = this.ctx.storage.sql;
    const tracker = measured(raw);
    const store = new Store(tracker.sql, (work) => this.ctx.storage.transactionSync(work), () => 1_000);
    raw.exec("DELETE FROM fields; DELETE FROM samples; DELETE FROM entries").toArray();
    const values = Array.from({ length: input.rows }, (_, index) => String(index + 1));
    for (let offset = 0; offset < values.length; offset += 10_000) {
      store.execute([{ op: "append", key: "history", values: values.slice(offset, offset + 10_000) }]);
    }
    if (input.gapped) {
      for (let seq = 997; seq < input.rows; seq += 997) {
        raw.exec("DELETE FROM samples WHERE key = 'history' AND seq = ?", seq).toArray();
      }
    }
    const actualRows = Number(raw.exec("SELECT COUNT(*) AS n FROM samples WHERE key = 'history'").toArray()[0]?.n ?? 0);
    tracker.reset();
    let result;
    const batchResults = [];
    if (input.operation === "append-trim" || input.operation === "telemetry-cycle") {
      for (let round = 0; round < input.rounds; round += 1) {
        const last = input.operation === "telemetry-cycle"
          ? store.execute([{ op: "listRange", key: "history", start: -1, stop: -1 }])
          : null;
        const write = store.execute([
          { op: "append", key: "history", values: [String(input.rows + round + 1)] },
          { op: "trim", key: "history", start: -input.keep, stop: -1 },
          { op: "expire", key: "history", ttlMs: 60_000 },
        ]);
        batchResults.push(last === null ? write : [last, write]);
      }
      result = raw.exec("SELECT value FROM samples WHERE key = 'history' ORDER BY seq").toArray()
        .map((row) => String(row.value));
    } else {
      for (let round = 0; round < input.rounds; round += 1) {
        result = store.execute([input.command])[0];
      }
    }
    return Response.json({
      variant: input.variant,
      actualRows,
      metrics: tracker.metrics,
      result: {
        length: Array.isArray(result) ? result.length : null,
        first: Array.isArray(result) ? result[0] ?? null : null,
        last: Array.isArray(result) ? result.at(-1) ?? null : null,
        digest: await digest(result),
        batchDigest: batchResults.length ? await digest(batchResults) : null,
        expiresAt: raw.exec("SELECT expires_at FROM entries WHERE key = 'history'").toArray()[0]?.expires_at ?? null,
      },
    });
  }
}
export default {
  fetch(request, env) {
    return env.BENCHMARK.get(env.BENCHMARK.idFromName("global")).fetch(request);
  },
};
`;

try {
  const baseDir = join(temporary, "base");
  const worktreeDir = join(temporary, "worktree");
  await Promise.all([
    import("node:fs/promises").then(({ mkdir }) => mkdir(baseDir, { recursive: true })),
    import("node:fs/promises").then(({ mkdir }) => mkdir(worktreeDir, { recursive: true })),
  ]);
  const [worktreeStore, worktreeContract] = await Promise.all([
    readFile(join(root, "shared/sqlite-store.ts"), "utf8"),
    readFile(join(root, "shared/storage-contract.ts"), "utf8"),
  ]);
  await Promise.all([
    writeFile(join(baseDir, "sqlite-store.ts"), localImport(atRef("shared/sqlite-store.ts"))),
    writeFile(join(baseDir, "storage-contract.ts"), atRef("shared/storage-contract.ts")),
    writeFile(join(worktreeDir, "sqlite-store.ts"), localImport(worktreeStore)),
    writeFile(join(worktreeDir, "storage-contract.ts"), worktreeContract),
    writeFile(join(temporary, "worker.ts"), workerSource),
  ]);
  const configPath = join(temporary, "wrangler.json");
  await writeFile(configPath, JSON.stringify({
    name: "do-storage-benchmark",
    main: join(temporary, "worker.ts"),
    compatibility_date: "2025-02-14",
    durable_objects: { bindings: [{ name: "BENCHMARK", class_name: "StorageBenchmark" }] },
    migrations: [{ tag: "v1", new_sqlite_classes: ["StorageBenchmark"] }],
  }));
  const port = await availablePort();
  child = spawn(process.execPath, [
    require.resolve("wrangler"), "dev", "--config", configPath,
    "--port", String(port), "--persist-to", join(temporary, "state"),
  ], {
    cwd: temporary,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (data) => logs.push(data.toString()));
  const endpoint = `http://127.0.0.1:${port}`;
  await eventually(async () => assert.equal((await fetch(endpoint)).status, 200));

  const scenarios = [
    { name: "all", command: { op: "listRange", key: "history", start: 0, stop: -1 } },
    { name: "tail-one", command: { op: "listRange", key: "history", start: -1, stop: -1 } },
    { name: "tail-2000", command: { op: "listRange", key: "history", start: -2000, stop: -1 } },
    { name: "negative-slice", command: { op: "listRange", key: "history", start: -2000, stop: -501 } },
    { name: "first-600", command: { op: "listRange", key: "history", start: 0, stop: 599 } },
    { name: "gapped-tail-one", gapped: true, command: { op: "listRange", key: "history", start: -1, stop: -1 } },
    { name: "gapped-negative-slice", gapped: true, command: { op: "listRange", key: "history", start: -2000, stop: -501 } },
    { name: "append-trim-2000", rows: 2000, operation: "append-trim", keep: 2000 },
    { name: "append-trim-6000", operation: "append-trim", keep: 6000 },
    { name: "telemetry-cycle-6000", operation: "telemetry-cycle", keep: 6000 },
  ];
  const report = {
    invocation: `node scripts/benchmark-do-storage.mjs --ref ${ref} --rows ${rows} --rounds ${rounds} --write-rounds ${writeRounds}`,
    ref,
    resolvedRef: execFileSync("git", ["rev-parse", `${ref}^{commit}`], { cwd: root, encoding: "utf8" }).trim(),
    worktreeStoreSha256: createHash("sha256").update(worktreeStore).digest("hex"),
    rows,
    rounds,
    writeRounds,
    scenarios: [],
  };
  for (const scenario of scenarios) {
    const scenarioRows = scenario.rows ?? rows;
    const scenarioRounds = scenario.operation ? writeRounds : rounds;
    const variants = {};
    for (const variant of ["base", "worktree"]) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          variant,
          rows: scenarioRows,
          rounds: scenarioRounds,
          gapped: scenario.gapped === true,
          operation: scenario.operation ?? "read",
          keep: scenario.keep,
          command: scenario.command,
        }),
      });
      const body = await response.text();
      assert.equal(response.status, 200, body);
      variants[variant] = JSON.parse(body);
    }
    const equivalent = JSON.stringify(variants.base.result) === JSON.stringify(variants.worktree.result);
    assert.equal(equivalent, true, `${scenario.name} result differs from ${ref}`);
    report.scenarios.push({
      name: scenario.name,
      gapped: scenario.gapped === true,
      operation: scenario.operation ?? "read",
      command: scenario.command,
      configuredRows: scenarioRows,
      rounds: scenarioRounds,
      actualRows: variants.worktree.actualRows,
      equivalent,
      base: variants.base.metrics,
      worktree: variants.worktree.metrics,
      result: variants.worktree.result,
    });
  }
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (logs.length) console.error(logs.join("").slice(-20_000));
  throw error;
} finally {
  child?.kill("SIGTERM");
  if (child && child.exitCode === null) await Promise.race([once(child, "exit"), new Promise((resolveWait) => setTimeout(resolveWait, 3000))]);
  await rm(temporary, { recursive: true, force: true });
}
