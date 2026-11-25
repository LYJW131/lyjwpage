import assert from "node:assert/strict";
import test from "node:test";

import type { CodingAgentRow } from "@/lib/coding-agents";
import {
  COMPACT_AGENT_ROW_PX,
  PLAYSTATION_BASE_HEIGHT,
  RESET_CARD_TOGGLE_PX,
  TROPHY_GROUPS_STRIP_PX,
  VIBE_CODING_BASE_HEIGHT,
  playstationCardHeight,
  vibeCodingCardHeight,
} from "@/lib/readme-card-heights";
import { AGENT_LIMITS_STALE_MS } from "@shared/freshness";

const NOW = Date.UTC(2026, 10, 25, 4, 0, 0);
const RESETS_AT_SEC = Math.floor((NOW + 3 * 86_400_000) / 1000);

function claudeRow(overrides: Partial<CodingAgentRow> = {}): CodingAgentRow {
  return {
    id: "claude",
    label: "Claude Code",
    icon: "anthropic",
    row: "featured",
    usage: null,
    activity: [],
    plan: null,
    limits: [],
    limitsError: null,
    limitsAt: NOW - 60_000,
    authRefreshExpiresAt: null,
    ...overrides,
  };
}

function compactRow(id: string): CodingAgentRow {
  return {
    id,
    label: id,
    icon: id,
    row: "compact",
    usage: null,
    activity: [],
    plan: null,
    limits: [],
    limitsError: null,
    limitsAt: null,
    authRefreshExpiresAt: null,
  };
}

test("vibeCodingCardHeight：Claude 限额缺失或过期时无 forecast，即使手上有周重置卡也不加 38px", () => {
  const compact = [compactRow("codex"), compactRow("cursor"), compactRow("antigravity"), compactRow("dsh")];
  const baseWith4Compact = VIBE_CODING_BASE_HEIGHT + 4 * COMPACT_AGENT_ROW_PX;

  assert.equal(
    vibeCodingCardHeight({
      rows: [claudeRow({ limits: [], limitsError: "Claude API returned 403" }), ...compact],
      history: null,
      resetCards: { fable: 0, standard: 1 },
      now: NOW,
    }),
    baseWith4Compact,
  );

  const weekly = { key: "claude.weekly", label: "Weekly", group: null, windowMinutes: 10080, usedPercent: 40, resetsAt: RESETS_AT_SEC };
  assert.equal(
    vibeCodingCardHeight({
      rows: [claudeRow({ limits: [weekly], limitsAt: NOW - AGENT_LIMITS_STALE_MS - 1000 }), ...compact],
      history: null,
      resetCards: { fable: 0, standard: 1 },
      now: NOW,
    }),
    baseWith4Compact,
  );

  assert.equal(
    vibeCodingCardHeight({
      rows: [claudeRow({ limits: [weekly], limitsAt: NOW - 60_000 }), ...compact],
      history: null,
      resetCards: { fable: 0, standard: 1 },
      now: NOW,
    }),
    baseWith4Compact + RESET_CARD_TOGGLE_PX,
  );
});

test("playstationCardHeight：展开多 DLC 分组游戏时补 GroupSlot 高度，单分组或无目录保持基高", () => {
  assert.equal(playstationCardHeight(null), PLAYSTATION_BASE_HEIGHT);
  assert.equal(playstationCardHeight([{ groups: [{ id: "default", name: "Base", iconUrl: null, progress: 50, earned: { bronze: 1, silver: 0, gold: 0, platinum: 0 }, defined: { bronze: 2, silver: 0, gold: 0, platinum: 0 } }] }]), PLAYSTATION_BASE_HEIGHT);
  assert.equal(
    playstationCardHeight([
      {
        groups: [
          { id: "default", name: "Base", iconUrl: null, progress: 80, earned: { bronze: 1, silver: 0, gold: 0, platinum: 0 }, defined: { bronze: 2, silver: 0, gold: 0, platinum: 0 } },
          { id: "002", name: "Burning Shores", iconUrl: null, progress: 100, earned: { bronze: 1, silver: 0, gold: 1, platinum: 0 }, defined: { bronze: 1, silver: 0, gold: 1, platinum: 0 } },
        ],
      },
    ]),
    PLAYSTATION_BASE_HEIGHT + TROPHY_GROUPS_STRIP_PX,
  );
});
