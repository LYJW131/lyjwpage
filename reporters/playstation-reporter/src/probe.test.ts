import assert from "node:assert/strict";
import test from "node:test";

import { parseDiscoveryResponse } from "../dist/probe.js";

test("discovery status lines map to awake, standby, and off", () => {
  const packet = (status: string) => Buffer.from(`${status}\nhost-type:PS5\nhost-name:PS5-210\n`);
  assert.equal(parseDiscoveryResponse(packet("HTTP/1.1 200 Ok")), "awake");
  assert.equal(parseDiscoveryResponse(packet("HTTP/1.1 620 Server Standby")), "standby");
  assert.equal(parseDiscoveryResponse(packet("HTTP/1.1 500")), "off");
  assert.equal(parseDiscoveryResponse(Buffer.from("not http")), "off");
});
