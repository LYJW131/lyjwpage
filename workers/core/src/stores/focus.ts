import { FOCUS_NOW_TAG } from "@shared/live-events";
import { focusMirror, focusNow, type FocusMode } from "@shared/focus";
import { fanout } from "@core/fanout";

export async function getFocusNow() {
  return focusNow(await focusMirror.get());
}

export function writeFocus({ mode, observedAt }: { mode: FocusMode | null; observedAt: number }): Promise<void> {
  return (async () => {
    const previous = await focusMirror.get();
    if (previous && observedAt <= previous.observedAt) return;
    const before = focusNow(previous, observedAt);
    const since = mode === null ? null : before.mode === mode ? before.since : observedAt;
    const after = focusNow({ mode, since, observedAt }, observedAt);
    await fanout({
      writes: [focusMirror.put(after)],
      events: before.mode !== after.mode ? [{ type: "focus-now", payload: after }] : [],
      tags: Boolean(before.mode) !== Boolean(after.mode) ? [FOCUS_NOW_TAG] : [],
    });
  })();
}
