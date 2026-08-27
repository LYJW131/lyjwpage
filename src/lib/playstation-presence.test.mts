import assert from "node:assert/strict";
import test from "node:test";

import { playstationPresenceKind } from "./playstation-presence.ts";

test("availability 三档：在线、忙碌、离线", () => {
  assert.equal(
    playstationPresenceKind({ online: true, availability: "availableToPlay" }),
    "online",
  );
  assert.equal(
    playstationPresenceKind({ online: true, availability: "doNotDisturb" }),
    "busy",
  );
  assert.equal(
    playstationPresenceKind({ online: false, availability: "unavailable" }),
    "offline",
  );
});

test("availability 缺席或未知时退回 online 布尔", () => {
  assert.equal(playstationPresenceKind({ online: true, availability: null }), "online");
  assert.equal(playstationPresenceKind({ online: false, availability: null }), "offline");
  assert.equal(
    playstationPresenceKind({ online: true, availability: "somethingElse" }),
    "online",
  );
});

test("没有 presence 就不下结论", () => {
  assert.equal(playstationPresenceKind(undefined), null);
});
