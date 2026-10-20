import { useMountedAt } from "@/hooks/use-mounted-at";
import { useConfirmedClockStale } from "@/hooks/use-stale";
import { CODING_ACTIVE_WINDOW_MS } from "@shared/coding-usage-view";
import { codingActivitySlots, codingDisplayModel, type CodingActivityEntry, type CodingAgentRow } from "@/lib/coding-agents";

export type FirstFrameClocks = {
  usage?: number;
  now?: number;
  nowValidating: boolean;
  limits?: number;
};

function useSlotLive(entry: CodingActivityEntry | null, clockKnown: boolean, clocks: FirstFrameClocks) {
  const expired = useConfirmedClockStale(entry?.lastActivityAt, CODING_ACTIVE_WINDOW_MS, {
    validating: clocks.nowValidating,
    servedAt: clocks.now,
  });
  return entry != null && clockKnown && !expired ? entry : null;
}

export function useAgentActive(row: CodingAgentRow, macDeclaredOffline: boolean, clocks: FirstFrameClocks) {
  const slots = codingActivitySlots(row.activity, macDeclaredOffline);
  const mountedAt = useMountedAt();
  const clockKnown = mountedAt > 0 || clocks.now != null;
  const mac = useSlotLive(slots.mac, clockKnown, clocks);
  const remote = useSlotLive(slots.remote, clockKnown, clocks);
  const sources = [mac, remote].filter((entry) => entry != null);
  const live = sources.reduce<CodingActivityEntry | null>(
    (newest, entry) => (newest == null || entry.lastActivityAt > newest.lastActivityAt ? entry : newest),
    null,
  );
  const active = live != null;
  return { active, sources: sources.map((entry) => entry.source), model: codingDisplayModel(row, live, active) };
}
