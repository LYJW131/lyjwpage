type ConnectionContext = {
  visible: boolean;
  online: boolean;
};

type ConnectionFailure =
  | { cause: "constructor_error" | "resume_closed" }
  | { cause: "socket_close"; closeCode: number; wasClean: boolean; hadError: boolean };

export type LiveConnectionLog = {
  outcome: "failed" | "recovered" | "aborted";
  phase: "initial" | "reconnect";
  cause: ConnectionFailure["cause"];
  retryAttempts: number;
  durationMs: number;
  visible: boolean;
  online: boolean;
  closeCode?: number;
  wasClean?: boolean;
  hadError?: boolean;
};

type Episode = {
  startedAt: number;
  phase: LiveConnectionLog["phase"];
  retryAttempts: number;
  failure: ConnectionFailure;
};

export function createLiveConnectionDiagnostics(
  report: (level: "warn" | "info", attributes: LiveConnectionLog) => void,
  now: () => number = () => performance.now(),
) {
  let hasConnected = false;
  let episode: Episode | null = null;

  function emit(outcome: LiveConnectionLog["outcome"], current: Episode, context: ConnectionContext): void {
    try {
      report(outcome === "failed" ? "warn" : "info", {
        outcome,
        phase: current.phase,
        cause: current.failure.cause,
        retryAttempts: current.retryAttempts,
        durationMs: Math.max(0, Math.round(now() - current.startedAt)),
        visible: context.visible,
        online: context.online,
        ...(current.failure.cause === "socket_close" ? {
          closeCode: current.failure.closeCode,
          wasClean: current.failure.wasClean,
          hadError: current.failure.hadError,
        } : {}),
      });
    } catch {}
  }

  function finish(outcome: "recovered" | "aborted", context: ConnectionContext): void {
    const current = episode;
    episode = null;
    if (current) emit(outcome, current, context);
  }

  return {
    attempt(): void {
      if (episode) episode.retryAttempts += 1;
    },
    fail(failure: ConnectionFailure, context: ConnectionContext): void {
      if (episode) return;
      episode = {
        startedAt: now(),
        phase: hasConnected ? "reconnect" : "initial",
        retryAttempts: 0,
        failure: failure.cause === "socket_close" ? {
          cause: failure.cause,
          closeCode: failure.closeCode,
          wasClean: failure.wasClean,
          hadError: failure.hadError,
        } : { cause: failure.cause },
      };
      emit("failed", episode, context);
    },
    ready(context: ConnectionContext): void {
      hasConnected = true;
      finish("recovered", context);
    },
    stop(context: ConnectionContext): void {
      hasConnected = false;
      finish("aborted", context);
    },
  };
}
