import assert from "node:assert/strict";
import { test } from "node:test";

import { CHAT_ARCHIVE_KEY, CHAT_ARCHIVE_LIMITS, boundChatArchive, createChatArchiveStore, readChatArchive, type ChatBubble } from "./chat-archive.ts";

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

const messages: ChatBubble[] = [
  { role: "user", content: "Improve the homepage" },
  { role: "assistant", content: "Here is the plan.", seal: "signed-pair", planToken: "signed-plan", trace: { tier: "opus" }, proposals: [{
    plan: { title: "Improve cards", spec: "Make cards readable.", acceptance: ["Readable at 375px"], paths: ["src/components/"] },
    token: "signed-plan", expiresAt: 3_600_000,
    build: { runId: "run", branch: "claude/build-run", statusToken: "signed-status" },
    run: { runId: "run", branch: "claude/build-run", phase: "running", createdAt: 1, updatedAt: 2 },
  }] },
];

test("restores signed history, design, plans and build identities after reload", () => {
  const data = storage();
  const first = createChatArchiveStore(() => data, () => "one", () => 123);
  const id = first.getSnapshot().activeId;
  const design = { token: "signed-design", expiresAt: 1800000, remaining: 11 };
  first.update(id, { messages, design });
  const restored = createChatArchiveStore(() => data).getSnapshot();
  assert.equal(restored.activeId, id);
  assert.deepEqual(restored.sessions[0].messages, messages);
  assert.deepEqual(restored.sessions[0].design, design);
});

test("new conversations retain history, switching restores it, and deletion repairs selection", () => {
  let sequence = 0;
  const store = createChatArchiveStore(() => storage(), () => String(++sequence), () => sequence);
  const first = store.getSnapshot().activeId;
  store.update(first, { messages });
  const second = store.start();
  assert.equal(store.getSnapshot().sessions.length, 2);
  store.select(first);
  assert.equal(store.getSnapshot().activeId, first);
  assert.deepEqual(store.getSnapshot().sessions.find((session) => session.id === first)?.messages, messages);
  store.remove(first);
  assert.equal(store.getSnapshot().activeId, second);
  assert.equal(store.getSnapshot().sessions.length, 1);
});

test("clear removes every saved session and the persisted key", () => {
  const data = storage();
  const store = createChatArchiveStore(() => data);
  store.update(store.getSnapshot().activeId, { messages });
  assert.ok(data.getItem(CHAT_ARCHIVE_KEY));
  store.clear();
  assert.deepEqual(store.getSnapshot().sessions, []);
  assert.equal(data.getItem(CHAT_ARCHIVE_KEY), null);
});

test("another tab's saved sessions and deletion refresh without changing an existing selection", () => {
  const data = storage();
  const first = createChatArchiveStore(() => data, () => "first", () => 1);
  first.update(first.getSnapshot().activeId, { messages });
  const second = createChatArchiveStore(() => data, () => "second", () => 2);
  second.start();
  second.update(second.getSnapshot().activeId, { messages: [{ role: "user", content: "Another idea" }] });
  first.reload();
  assert.equal(first.getSnapshot().activeId, "first");
  assert.equal(first.getSnapshot().sessions.length, 2);
  first.clear();
  second.reload();
  assert.equal(second.getSnapshot().sessions.length, 1);
  assert.deepEqual(second.getSnapshot().sessions[0].messages, []);
});

test("blocked localStorage and quota failures keep working in memory", () => {
  const unavailable = createChatArchiveStore(() => { throw new Error("denied"); });
  const id = unavailable.getSnapshot().activeId;
  unavailable.update(id, { messages });
  assert.deepEqual(unavailable.getSnapshot().sessions[0].messages, messages);
  unavailable.clear();
  assert.equal(unavailable.getSnapshot().sessions.length, 0);
  let writes = 0;
  const full = createChatArchiveStore(() => ({ getItem: () => null, removeItem: () => {}, setItem: () => { writes++; throw new Error("quota"); } }));
  const fullId = full.getSnapshot().activeId;
  full.update(fullId, { messages });
  full.update(fullId, { design: { token: "signed", expiresAt: 2, remaining: 1 } });
  assert.equal(writes, 1);
  assert.deepEqual(full.getSnapshot().sessions[0].messages, messages);
});

test("session count and UTF-8 size limits evict the oldest conversations", () => {
  const sessions = Array.from({ length: CHAT_ARCHIVE_LIMITS.sessions + 3 }, (_, index) => ({ id: String(index), title: "Session", createdAt: index, updatedAt: index, messages }));
  const bounded = boundChatArchive({ version: 1, activeId: "0", sessions });
  assert.equal(bounded.sessions.length, CHAT_ARCHIVE_LIMITS.sessions);
  assert.equal(bounded.sessions.at(-1)?.id, "3");
  assert.equal(bounded.activeId, "22");
  const large = boundChatArchive({ version: 1, activeId: "new", sessions: [
    { id: "old", title: "Old", createdAt: 1, updatedAt: 1, messages: [{ role: "user", content: "字".repeat(CHAT_ARCHIVE_LIMITS.bytes / 2) }] },
    { id: "new", title: "New", createdAt: 2, updatedAt: 2, messages },
  ] });
  assert.deepEqual(large.sessions.map((session) => session.id), ["new"]);
  assert.ok(new TextEncoder().encode(JSON.stringify(large)).byteLength <= CHAT_ARCHIVE_LIMITS.bytes);
});

test("an oversized active conversation drops whole old pairs", () => {
  const archive = boundChatArchive({ version: 1, activeId: "one", sessions: [{ id: "one", title: "Large", createdAt: 1, updatedAt: 1, messages: [
    { role: "user", content: "x".repeat(CHAT_ARCHIVE_LIMITS.bytes) }, { role: "assistant", content: "old reply" }, ...messages,
  ] }] });
  assert.deepEqual(archive.sessions[0].messages, messages);
});

test("corrupt, unsupported, or oversized storage does not crash restoration", () => {
  for (const raw of ["bad JSON", '{"version":2}', "x".repeat(CHAT_ARCHIVE_LIMITS.bytes + 1), '{"version":1,"sessions":[{"id":"bad"}]}']) {
    assert.deepEqual(readChatArchive(raw).sessions, []);
  }
});
