import { BUILD_CLOSED_PHASES, BUILD_FAILED_PHASES, type BuildPhase, type BuildRun } from "@shared/build-routine";

export const BUILD_STATUS_POLL_MS = 10_000;

export function isBuildTerminal(phase?: BuildPhase): boolean {
  return phase !== undefined && (BUILD_CLOSED_PHASES.includes(phase) || BUILD_FAILED_PHASES.includes(phase));
}

export function createBuildStatusPoller({ load, onRun, onError }: {
  load: (signal: AbortSignal) => Promise<BuildRun>;
  onRun: (run: BuildRun) => void;
  onError: (error: unknown) => void;
}) {
  let stopped = false;
  let visible = false;
  let request: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cancel() {
    if (timer) clearTimeout(timer);
    timer = null;
    request?.abort();
    request = null;
  }

  async function poll() {
    if (stopped || !visible || request) return;
    const controller = new AbortController();
    request = controller;
    try {
      const run = await load(controller.signal);
      if (controller.signal.aborted) return;
      stopped = isBuildTerminal(run.phase);
      onRun(run);
    } catch (error) {
      if (!controller.signal.aborted) onError(error);
    } finally {
      if (request === controller) {
        request = null;
        if (!stopped && visible) timer = setTimeout(() => { timer = null; void poll(); }, BUILD_STATUS_POLL_MS);
      }
    }
  }

  return {
    setVisible(value: boolean) {
      visible = value;
      if (!visible) cancel();
      else if (!timer) return poll();
    },
    stop() { stopped = true; cancel(); },
  };
}
