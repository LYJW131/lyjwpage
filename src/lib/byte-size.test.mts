import assert from "node:assert/strict";
import test from "node:test";

import { BINARY_TIERS, DECIMAL_TIERS, formatBytePair, formatBytes } from "./byte-size.ts";

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;

test("memory and disk pairs use 1024-based GB, not decimal gigabytes", () => {
  assert.equal(formatBytePair(BINARY_TIERS, 3 * GiB, 30 * GiB), "3.0 / 30.0 GB");
  assert.equal(formatBytePair(BINARY_TIERS, 612 * MiB, 2 * GiB), "0.6 / 2.0 GB");
  assert.equal(formatBytePair(BINARY_TIERS, 500 * MiB, 800 * MiB), "500 / 800 MB");
});

test("traffic uses decimal tiers and the pair shares the total's tier", () => {
  assert.equal(formatBytePair(DECIMAL_TIERS, 850e9, 2e12), "0.85 / 2.00 TB");
  assert.equal(formatBytes(DECIMAL_TIERS, 1.5e9), "1.5 GB");
  assert.equal(formatBytes(DECIMAL_TIERS, 0), "0 MB");
});

test("binary tiers switch to 1024-based TB from one TiB", () => {
  const TiB = 1024 ** 4;
  assert.equal(formatBytes(BINARY_TIERS, 2 * TiB), "2.00 TB");
  assert.equal(formatBytePair(BINARY_TIERS, 512 * GiB, 4 * TiB), "0.50 / 4.00 TB");
  assert.equal(formatBytes(BINARY_TIERS, 1023 * GiB), "1023.0 GB");
});
