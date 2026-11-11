import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type { HistoryDb } from "@shared/history-ingest";
import type { PreparedPlayerEvents } from "@shared/ingest/player";

import { ALL, MAC_OTLP, OMARCHY, json, world } from "./testing/world";

const HERE = dirname(fileURLToPath(import.meta.url));
// Ringo 的 telemetry.Plays 经官方 otlploghttp exporter 发出的原始请求体：一首歌的开始、从 30 秒跳到 120 秒、在 150 秒放完。
const RINGO_SAMPLE = new Uint8Array(readFileSync(`${HERE}/../../../shared/testing/ringo-plays.pb`));
const MAC = "/api/ingest/mac/otlp";
const OMARCHY_PATH = "/api/ingest/omarchy/otlp";

type Statement = { query: string; values: unknown[] };

function withHistory(w: ReturnType<typeof world>) {
  const sqlite = new DatabaseSync(":memory:");
  const migrations = `${HERE}/../../core/migrations/`;
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(`${migrations}${file}`, "utf8"));
  }
  const db: HistoryDb = {
    prepare: (query) => {
      const statement: Statement & { bind(...values: unknown[]): typeof statement } = { query, values: [], bind: (...values) => ({ ...statement, values }) };
      return statement;
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      for (const { query, values } of statements as unknown as Statement[]) sqlite.prepare(query).run(...(values as (string | number | null)[]));
      sqlite.exec("COMMIT");
      return [];
    },
  };
  (w.env as { HISTORY: unknown }).HISTORY = db;
  return () => sqlite.prepare("SELECT * FROM listening_events ORDER BY time_unix_nano, event").all() as Record<string, unknown>[];
}

const protobuf = (body: Uint8Array, client: string | null = MAC_OTLP) => ({ body, client, headers: { "content-type": "application/x-protobuf" } });

test("player otlp: the Mac's real protobuf batch reaches the state core as the player slot's latest state and every event is archived", async () => {
  const w = world();
  const rows = withHistory(w);
  const response = await w.send(MAC, protobuf(RINGO_SAMPLE));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/x-protobuf");
  assert.equal((await response.arrayBuffer()).byteLength, 0);

  assert.equal(w.calls.commits.length, 1);
  const command = w.calls.commits[0] as PreparedPlayerEvents;
  assert.equal(command.source, "player");
  assert.equal(command.device, "mac");
  assert.deepEqual(
    { ...command.stored.music, observedAt: 0 },
    {
      source: "mac", state: "stopped", title: "Song 名", artist: "Artist A, Artist B", album: "Album X", trackId: "1440818839",
      artworkUrl: null, positionMs: 150_000, durationMs: 215_000, repeatOne: false, observedAt: 0,
    },
  );
  assert.equal(w.calls.enriched.length, 1, "the collector is asked to fill in artwork and links, as for Mac and HomePod");

  const archived = rows();
  assert.deepEqual(archived.map((row) => row.event), ["ringo.play.start", "ringo.play.seek", "ringo.play.end"]);
  for (const row of archived) {
    assert.equal(row.source, "mac");
    assert.match(String(row.time_unix_nano), /^\d{19}$/);
    assert.ok(Math.abs(Number(row.occurred_at) - Number(row.time_unix_nano) / 1e6) <= 1);
    assert.equal(row.service_version, "1.2.3");
  }
  const [start, seek, end] = archived.map((row) => JSON.parse(String(row.attributes)) as Record<string, unknown>);
  assert.equal(start!["music.resumed"], false);
  assert.equal(start!["music.origin.kind"], "album");
  assert.equal(start!["music.mode.repeat"], "all");
  assert.equal(seek!["music.seek.from_ms"], 30_000);
  assert.equal(archived[1]!.heard_ms, 30_000);
  assert.equal(end!["music.stop.reason"], "ended");
  assert.equal(archived[2]!.heard_ms, 30_000);

  const gzipped = new Uint8Array(await new Response(new Blob([RINGO_SAMPLE]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
  const retried = await w.send(MAC, { ...protobuf(gzipped), headers: { "content-type": "application/x-protobuf", "content-encoding": "gzip" } });
  assert.equal(retried.status, 200);
  assert.equal(rows().length, 3, "a batch the exporter sends again is not archived twice");
});

test("player otlp: OTLP JSON from Omarchy, int64 as strings, lands as a paused Omarchy player and answers {}", async () => {
  const w = world();
  const body = {
    resourceLogs: [{
      resource: { attributes: [{ key: "service.name", value: { stringValue: "ringo" } }] },
      scopeLogs: [{
        logRecords: [
          { timeUnixNano: "1794300000000000000", eventName: "ringo.play.start", attributes: [{ key: "music.track.id", value: { stringValue: "i.abc" } }, { key: "music.track.name", value: { stringValue: "Upload" } }] },
          {
            timeUnixNano: "1794300000123456789",
            eventName: "ringo.play.end",
            attributes: [
              { key: "music.track.id", value: { stringValue: "i.abc" } },
              { key: "music.track.name", value: { stringValue: "Upload" } },
              { key: "music.track.duration_ms", value: { intValue: "200000" } },
              { key: "music.position_ms", value: { intValue: 90000 } },
              { key: "music.stop.reason", value: { stringValue: "paused" } },
              { key: "music.mode.repeat", value: { stringValue: "one" } },
            ],
          },
          { timeUnixNano: "1794300000000000001", eventName: "something.else", attributes: [] },
        ],
      }],
    }],
  };
  const response = await w.send(OMARCHY_PATH, { body: JSON.stringify(body), client: OMARCHY, headers: { "content-type": "application/json" } });
  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), {});
  const command = w.calls.commits[0] as PreparedPlayerEvents;
  assert.equal(command.device, "omarchy");
  assert.equal(command.events.length, 2, "records that are not play events are skipped");
  const { music } = command.stored;
  assert.equal(music.source, "omarchy");
  assert.equal(music.state, "paused");
  assert.equal(music.positionMs, 90_000);
  assert.equal(music.durationMs, 200_000);
  assert.equal(music.repeatOne, true);
  assert.equal(music.observedAt, 1_794_300_000_123);
});

test("player otlp: no Access credential is 401, a token of another machine is 403, and nothing reaches the state core", async () => {
  const w = world();
  assert.equal((await w.send(MAC, protobuf(RINGO_SAMPLE, null))).status, 401);
  const bearer = await w.send(MAC, { ...protobuf(RINGO_SAMPLE, null), headers: { "content-type": "application/x-protobuf", authorization: "Bearer anything" } });
  assert.equal(bearer.status, 401);
  assert.equal((await w.send(MAC, protobuf(RINGO_SAMPLE, ALL))).status, 403);
  assert.equal((await w.send(MAC, protobuf(RINGO_SAMPLE, OMARCHY))).status, 403);
  assert.equal((await w.send(OMARCHY_PATH, protobuf(RINGO_SAMPLE, MAC_OTLP))).status, 403);
  assert.equal(w.calls.commits.length, 0);
});

test("player otlp: bad bodies are 400 or 415 so the exporter drops them, a state core that can't take it now is 503 so it sends again", async () => {
  const w = world();
  assert.equal((await w.send(MAC, protobuf(RINGO_SAMPLE.subarray(0, 100)))).status, 400);
  assert.equal((await w.send(MAC, { body: "{", client: MAC_OTLP, headers: { "content-type": "application/json" } })).status, 400);
  assert.equal((await w.send(MAC, { body: RINGO_SAMPLE, client: MAC_OTLP, headers: { "content-type": "text/plain" } })).status, 415);
  assert.equal((await w.send(MAC, { ...protobuf(RINGO_SAMPLE), headers: { "content-type": "application/x-protobuf", "content-encoding": "br" } })).status, 415);
  assert.equal((await w.send(MAC, { method: "GET", client: MAC_OTLP })).status, 405);
  assert.equal(w.calls.commits.length, 0);

  const busy = world({ reply: () => ({ ready: true, ok: false, error: "reset", retryable: true }) });
  assert.equal((await busy.send(MAC, protobuf(RINGO_SAMPLE))).status, 503);
  assert.deepEqual(busy.calls.archived, [], "nothing is archived when the state core did not take it");
});
