"use client";

import { createContext, lazy, Suspense, useContext, useId, type ReactNode } from "react";

import { MODAL_ACTION_CLASS, Modal } from "@/components/ui/modal";
import { useWebPlayerState, type WebPlayer } from "@/hooks/use-web-player";
import { reportError } from "@/lib/error-report";

function PlayerLoadingDialog({ player, failed = false }: { player: WebPlayer; failed?: boolean }) {
  const titleId = useId();
  return (
    <Modal titleId={titleId} onClose={player.closeDialog}>
      <div className="flex flex-col gap-3 px-4 pb-4">
        <h2 id={titleId} className="label-mono text-muted-foreground">Web Player</h2>
        <p role={failed ? "alert" : "status"} className="text-sm text-muted-foreground">
          {failed ? "The player could not load." : "Loading player…"}
        </p>
      </div>
      <div className="flex divide-x divide-line border-t border-line">
        <button type="button" onClick={player.closeDialog} className={MODAL_ACTION_CLASS}>Close</button>
        {failed ? (
          <button type="button" onClick={() => window.location.reload()} className={MODAL_ACTION_CLASS}>Reload</button>
        ) : null}
      </div>
    </Modal>
  );
}

function PlayerUnavailable({ player }: { player: WebPlayer }) {
  return <PlayerLoadingDialog player={player} failed />;
}

const WebPlayerDialog = lazy(() =>
  import("@/components/web-player/web-player-dialog").then(
    (module) => ({ default: module.WebPlayerDialog }),
    (error: unknown) => {
      reportError(error, "boundary", { card: "Web Player" });
      return { default: PlayerUnavailable };
    },
  ),
);

const WebPlayerContext = createContext<WebPlayer | null>(null);

export function WebPlayerProvider({ children }: { children: ReactNode }) {
  const player = useWebPlayerState();

  return (
    <WebPlayerContext.Provider value={player}>
      {children}
      {player.open && player.item ? (
        <Suspense fallback={<PlayerLoadingDialog player={player} />}>
          <WebPlayerDialog key={player.item.id} player={player} />
        </Suspense>
      ) : null}
    </WebPlayerContext.Provider>
  );
}

export function useWebPlayer(): WebPlayer | null {
  return useContext(WebPlayerContext);
}
