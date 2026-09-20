import assert from "node:assert/strict";
import test from "node:test";
import { publicConnections } from "./connections.ts";

test("publishes only public, active connections and allowlisted fields", () => {
  assert.deepEqual(publicConnections([
    { type: "github", id: "1", name: "public", visibility: 1, access_token: "never-publish" },
    { type: "steam", id: "2", name: "private", visibility: 0 },
    { type: "twitter", id: "3", name: "revoked", visibility: 1, revoked: true },
    { type: "youtube", id: "4", name: "unknown visibility" },
  ]), [{ type: "github", id: "1", name: "public" }]);
});
test("rejects non-list API responses", () => assert.throws(() => publicConnections({ message: "unauthorized" })));
