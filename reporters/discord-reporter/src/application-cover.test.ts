import assert from "node:assert/strict";
import test from "node:test";

import { coverUrlFromRpc } from "./application-cover.ts";

test("cover_image 优先于 icon，静态图走 webp", () => {
  assert.equal(
    coverUrlFromRpc("123", { cover_image: "abc", icon: "def" }),
    "https://cdn.discordapp.com/app-icons/123/abc.webp?size=256",
  );
  assert.equal(
    coverUrlFromRpc("123", { icon: "def" }),
    "https://cdn.discordapp.com/app-icons/123/def.webp?size=256",
  );
});

test("a_ 前缀是动图，走 gif", () => {
  assert.equal(
    coverUrlFromRpc("123", { cover_image: "a_abc" }),
    "https://cdn.discordapp.com/app-icons/123/a_abc.gif?size=256",
  );
});

test("封面和图标都没有就是 null", () => {
  assert.equal(coverUrlFromRpc("123", {}), null);
});
