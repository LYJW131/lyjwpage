import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { CHAT_CODE_PATHS, chatCodeVersion } from "../../scripts/chat-code-version.mjs";
import { CHAT_CONSENT_KEY, createChatConsentStore } from "./chat-consent.ts";

function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

test("consent persists for the same chat code version and lapses when it changes", () => {
  const data = storage();
  const store = createChatConsentStore(() => data, "v1", () => 42);
  assert.equal(store.getSnapshot(), false);
  store.accept();
  assert.deepEqual(JSON.parse(data.values.get(CHAT_CONSENT_KEY)!), { version: "v1", acceptedAt: 42 });
  assert.equal(createChatConsentStore(() => data, "v1").getSnapshot(), true);
  assert.equal(createChatConsentStore(() => data, "v2").getSnapshot(), false);
});

test("consent holds for the page when the browser refuses to store it", () => {
  const store = createChatConsentStore(() => ({ getItem: () => null, setItem: () => { throw new Error("quota"); } }), "v1");
  store.accept();
  assert.equal(store.getSnapshot(), true);
});

test("chat code version tracks source edits but ignores tests", () => {
  const root = mkdtempSync(join(tmpdir(), "chat-code-"));
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  for (const path of CHAT_CODE_PATHS) write(path.includes(".") ? path : join(path, "index.ts"), path);
  const base = chatCodeVersion(root);
  write("workers/ai/src/chat/handler.test.ts", "test");
  assert.equal(chatCodeVersion(root), base);
  write("workers/ai/src/chat/handler.ts", "changed");
  assert.notEqual(chatCodeVersion(root), base);
});

test("every chat code path exists in the repo", () => {
  assert.match(chatCodeVersion(process.cwd()), /^[0-9a-f]{16}$/);
});
