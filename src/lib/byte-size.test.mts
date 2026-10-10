import assert from "node:assert/strict";
import test from "node:test";

import { formatBinaryPair } from "./byte-size.ts";

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;

test("memory and disk pairs use 1024-based GB, not decimal gigabytes", () => {
  assert.equal(formatBinaryPair(3 * GiB, 30 * GiB), "3.0 / 30.0 GB");
  assert.equal(formatBinaryPair(612 * MiB, 2 * GiB), "0.6 / 2.0 GB");
  assert.equal(formatBinaryPair(500 * MiB, 800 * MiB), "500 / 800 MB");
});
